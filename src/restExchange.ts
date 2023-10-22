/*eslint-disable no-prototype-builtins */

import {
  OperationType,
  type Exchange,
  type Operation,
  makeResult,
  makeErrorResult,
} from '@urql/core';
import { fromPromise, pipe, merge, filter, mergeMap, map } from 'wonka';
import {
  type DocumentNode,
  OperationTypeNode,
  type SelectionSetNode,
  FragmentDefinitionNode,
} from 'graphql';

export type InitializationHeaders = Headers | string[][];
export type Endpoint = string;
export type RequestedFieldsMap = Record<string, any>;
export interface FieldMap {
  [key: string]: FieldMap;
}

export interface SerializedBody {
  body: any;
  headers: InitializationHeaders;
}
export type Serializer = (data: any, headers: Headers) => SerializedBody;
export type Serializers = Record<string, Serializer>;

export interface RestDirective {
  endpoint?: Endpoint;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  bodyKey?: string;
  type: string;
  bodySerializer: string;
}

export type Endpoints = Record<string, Endpoint>;

export interface RestExchangeOptions {
  endpoints: Endpoints;
  uri?: string;
  bodySerializers?: Serializers;
}

const DEFAULT_ENDPOINT_KEY = '';
const DEFAULT_SERIALIZER_KEY = '';

const DEFAULT_JSON_SERIALIZER: Serializer = (data: any, headers: Headers) => {
  if (!headers.has('content-type')) {
    headers.append('Content-Type', 'application/json');
  }
  return {
    body: JSON.stringify(data),
    headers,
  };
};

export const restExchange =
  (options: RestExchangeOptions): Exchange =>
  ({ forward }) => {
    return ops$ => {
      const restOps$ = pipe(
        ops$,
        filter((operation: Operation) => hasRestDirective(operation.query)),
        mergeMap((operation: Operation) =>
          pipe(
            fromPromise(executeRestRequest(operation, options)),
            map(response => {
              if (response?.error) {
                return makeErrorResult(operation, response.error);
              }
              return makeResult(operation, response);
            })
          )
        )
      );
      const forwardedOps$ = pipe(
        ops$,
        filter((operation: Operation) => !hasRestDirective(operation.query)),
        forward
      );

      return merge([restOps$, forwardedOps$]);
    };
  };

export const hasRestDirective = (query: DocumentNode): boolean => {
  for (const def of query.definitions) {
    if (def.kind !== 'OperationDefinition') continue;
    for (const sel of def.selectionSet.selections) {
      if (sel.directives?.some(dir => dir.name.value === 'rest')) {
        return true;
      }
    }
  }
  return false;
};

export const executeRestRequest = async (
  operation: Operation,
  options: RestExchangeOptions
) => {
  try {
    const { variables, kind, query } = operation;
    const { endpoints, bodySerializers, uri } = options;
    if (uri == null && endpoints == null) {
      throw new Error(
        'A RestLink must be initialized with either 1 uri, or a map of keyed-endpoints'
      );
    }
    if (uri != null) {
      const currentDefaultURI = (endpoints || {})[DEFAULT_ENDPOINT_KEY];
      if (currentDefaultURI != null && currentDefaultURI != uri) {
        throw new Error(
          "RestLink was configured with a default uri that doesn't match what's passed in to the endpoints map."
        );
      }
      endpoints[DEFAULT_ENDPOINT_KEY] = uri;
    }

    if (endpoints[DEFAULT_ENDPOINT_KEY] == null) {
      console.warn(
        'RestLink configured without a default URI. All @rest(…) directives must provide an endpoint key!'
      );
    }
    const serializers: Serializers = {
      [DEFAULT_SERIALIZER_KEY]: DEFAULT_JSON_SERIALIZER,
      ...(bodySerializers || {}),
    };
    const restDirective = getRestDirective(query);
    if (!restDirective) throw new Error('No @rest directive found');
    let { endpoint, path, bodyKey, method, type, bodySerializer } =
      restDirective;
    const fetchURI = getURIFromEndpoints(endpoints, endpoint);

    if (!fetchURI) {
      throw new Error('URL endpoint not defined');
    }
    const fetchOptions =
      typeof operation.context.fetchOptions === 'function'
        ? operation.context.fetchOptions()
        : operation.context.fetchOptions || {};
    const headers = (fetchOptions.headers || {}) as Headers;
    // Substitute variables in the path
    const pathWithParams = pathBuilder(path, variables);
    method = method || 'GET';
    let body;
    let overrideHeaders: Headers | undefined;
    if (!['GET', 'DELETE'].includes(method)) {
      body = variables?.[bodyKey || 'input'];
      if (!body) {
        throw new Error(
          '[GraphQL mutation using a REST call without a body]. No `input` was detected. Pass bodyKey to the @rest() directive to resolve this.'
        );
      }
      let serializedBody: SerializedBody;
      if (typeof bodySerializer === 'string') {
        if (!serializers.hasOwnProperty(bodySerializer)) {
          throw new Error(
            '"bodySerializer" must correspond to configured serializer. ' +
              `Please make sure to specify a serializer called ${bodySerializer} in the "bodySerializers" property.`
          );
        }
        serializedBody = serializers[bodySerializer](body, headers);
      } else {
        serializedBody = serializers[DEFAULT_SERIALIZER_KEY](body, headers);
      }

      body = serializedBody.body;
      overrideHeaders = new Headers(serializedBody.headers as Headers);
    }

    validateRequestMethodForOperationType(method, kind);
    const url = `${fetchURI}${pathWithParams}`;
    const response = await fetch(url, {
      method,
      body,
      headers: overrideHeaders || headers,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fetch error: ${response.status} ${errorText}`);
    }
    let responseData;
    try {
      responseData = await response.json();
    } catch (err) {
      throw new Error('Failed to parse JSON response.');
    }

    // Add __typename to the outermost data and any nested fields
    addTypename(responseData, type, query);
    // Ensure the main @rest field exists in the responseData
    const mainField = Object.keys(getRequestedFields(query))[0];
    // Omit the responseData to match the fields requested in the GraphQL query
    const ommitedFields = omitExtraFields({ [mainField]: responseData }, query);

    return { data: ommitedFields };
  } catch (error) {
    if (error instanceof Error) {
      return {
        data: null,
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack,
        },
      };
    }
    return {
      data: null,
      error: {
        message: 'Unexpected error',
        name: 'Unexpected',
      },
    };
  }
};

export const addTypename = (
  data: any,
  typename: string | null,
  query: DocumentNode
) => {
  if (!data || typeof data !== 'object') return;
  // If data is an array of objects
  if (Array.isArray(data)) {
    data.forEach(item => {
      if (typeof item === 'object' && item !== null) {
        addTypename(item, typename, query);
      }
    });
    return; // Exit early after processing the array
  }
  // Assign the given typename to the outermost data
  if (typename) data.__typename = typename;
  if (!query.definitions || !Array.isArray(query.definitions)) return; // Add this safety check

  // Process nested fields and assign typenames based on the @type directive
  for (const [fieldName, fieldValue] of Object.entries(data)) {
    const nestedTypename = getTypeFromQuery(query, fieldName);
    if (Array.isArray(fieldValue)) {
      fieldValue.forEach(item => {
        addTypename(item, nestedTypename, query);
      });
    } else if (fieldValue && typeof fieldValue === 'object') {
      addTypename(fieldValue, nestedTypename, query);
    }
  }
};

export const getTypeDirectiveForField = (
  query: DocumentNode,
  selectionSet: SelectionSetNode,
  fieldName: string
): string | null => {
  // Look through all selections in the selection set
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      // If the field's name matches our target field
      if (selection.name.value === fieldName) {
        // Check for directives on this field
        for (const directive of selection.directives || []) {
          if (directive.name.value === 'type') {
            const argument = directive.arguments?.find(
              arg => arg.name.value === 'name'
            );
            if (argument && argument.value.kind === 'StringValue') {
              return argument.value.value;
            }
          }
        }
      }

      // If the field has a nested selection set, search recursively inside it
      if (selection.selectionSet) {
        const nestedResult = getTypeDirectiveForField(
          query,
          selection.selectionSet,
          fieldName
        );
        if (nestedResult) return nestedResult;
      }
    } else if (selection.kind === 'FragmentSpread') {
      const fragment = query.definitions.find(
        def =>
          def.kind === 'FragmentDefinition' &&
          def.name.value === selection.name.value
      );

      if (fragment) {
        const nestedResult = getTypeDirectiveForField(
          query,
          fragment.selectionSet,
          fieldName
        );
        if (nestedResult) return nestedResult;
      }
    } else if (selection.kind === 'InlineFragment') {
      const nestedResult = getTypeDirectiveForField(
        query,
        selection.selectionSet,
        fieldName
      );
      if (nestedResult) return nestedResult;
    }
  }

  return null;
};

export const getTypeFromQuery = (
  query: DocumentNode,
  fieldName: string
): string | null => {
  for (const definition of query.definitions) {
    if (definition.kind !== 'OperationDefinition') continue;

    const result = getTypeDirectiveForField(
      query,
      definition.selectionSet,
      fieldName
    );
    if (result) return result;
  }

  return null;
};

export const omitExtraFields = (data: any, query: DocumentNode) => {
  const requestedFields: RequestedFieldsMap = getRequestedFields(query);

  function filterData(data: any, fields: RequestedFieldsMap): any {
    if (!data || typeof data !== 'object') return data;

    if (Array.isArray(data)) {
      return data.map(item => filterData(item, fields));
    } else {
      const filtered: Record<string, any> = {};
      for (const key of Object.keys(data)) {
        if (fields[key]) {
          filtered[key] = filterData(data[key], fields[key]);
        }
      }
      return filtered;
    }
  }

  return filterData(data, requestedFields);
};

export const getRequestedFields = (query: DocumentNode): FieldMap => {
  const fields: FieldMap = {};

  const collectFields = (
    selectionSet: SelectionSetNode | undefined
  ): FieldMap => {
    const currentFields: FieldMap = {};

    if (!selectionSet) {
      return currentFields;
    }

    for (const selection of selectionSet.selections) {
      if (selection.kind === 'Field') {
        currentFields[selection.name.value] = collectFields(
          selection.selectionSet
        );
      } else if (selection.kind === 'FragmentSpread') {
        const fragment = query.definitions.find(
          def =>
            def.kind === 'FragmentDefinition' &&
            def.name.value === selection.name.value
        ) as FragmentDefinitionNode | undefined;

        if (fragment) {
          Object.assign(currentFields, collectFields(fragment.selectionSet));
        }
      } else if (selection.kind === 'InlineFragment') {
        Object.assign(currentFields, collectFields(selection.selectionSet));
      }
    }

    return currentFields;
  };

  for (const definition of query.definitions) {
    if (definition.kind === 'OperationDefinition') {
      Object.assign(fields, collectFields(definition.selectionSet));
    }
  }

  return fields;
};

export const getRestDirective = (query: any): RestDirective | null => {
  for (const def of query.definitions) {
    if (def.kind !== 'OperationDefinition') continue;
    for (const sel of def.selectionSet.selections) {
      const restDirective = sel.directives?.find(
        dir => dir.name.value === 'rest'
      );
      if (restDirective) {
        const args = restDirective.arguments?.reduce((acc, arg) => {
          acc[arg.name.value] = arg.value.value;
          return acc;
        }, {});
        return args;
      }
    }
  }
  return null;
};

export const replaceParam = (
  endpoint: string,
  name: string | undefined,
  value: string | undefined
): string => {
  if (value === undefined || name === undefined) {
    return endpoint;
  }
  // Use a global regex to replace all occurrences
  const regex = new RegExp(`:${name}`, 'g');
  return endpoint.replace(regex, value);
};

export const pathBuilder = (path: string, variables): string => {
  const pathWithParams = Object.keys(variables).reduce(
    (acc, e) => replaceParam(acc, e, variables[e]),
    path
  );
  if (pathWithParams.includes(':')) {
    throw new Error(
      'Missing params to run query, specify it in the query params'
    );
  }
  return pathWithParams;
};

export const validateRequestMethodForOperationType = (
  method: string,
  operationType: OperationType
) => {
  switch (operationType) {
    case OperationTypeNode.QUERY:
      if (method.toUpperCase() !== 'GET') {
        throw new Error(
          `A "query" operation can only support "GET" requests but got "${method}".`
        );
      }
      return;
    case OperationTypeNode.MUTATION:
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
        return;
      }
      throw new Error('"mutation" operations do not support that HTTP-verb');
    case 'subscription':
      throw new Error('A "subscription" operation is not supported yet.');
    default:
      return operationType;
  }
};

export const getURIFromEndpoints = (
  endpoints: Endpoints,
  endpoint?: Endpoint
) => {
  return (
    endpoints[endpoint || DEFAULT_ENDPOINT_KEY] ||
    endpoints[DEFAULT_ENDPOINT_KEY]
  );
};
