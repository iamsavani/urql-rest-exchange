import {
  hasRestDirective,
  getRestDirective,
  addTypename,
  getTypeFromQuery,
  getTypeDirectiveForField,
  FieldMap,
  getRequestedFields,
  omitExtraFields,
  replaceParam,
  pathBuilder,
  validateRequestMethodForOperationType,
  getURIFromEndpoints,
} from './restExchange';
import { DocumentNode, FragmentDefinitionNode, parse } from 'graphql';
import { expect, it, describe } from 'vitest';

type Result = { [index: string]: any };


describe('restExchange', () => {
  describe('hasRestDirective', () => {
    it('should return true if the query has a @rest directive', () => {
      const mockQuery: DocumentNode = parse(`
        query {
          user @rest(type: "User", path: "/users/1") {
            id
            name
          }
        }
      `);
      expect(hasRestDirective(mockQuery)).toBe(true);
    });

    it('should return false if the query does not have a @rest directive', () => {
      const mockQuery: DocumentNode = parse(`
        query {
          user {
            id
            name
          }
        }
      `);
      expect(hasRestDirective(mockQuery)).toBe(false);
    });
  });

  describe('getRestDirective', () => {
    it('should return null when no @rest directive is present', () => {
      const query = parse(`
          {
            user {
              id
              name
            }
          }
        `);

      const directive = getRestDirective(query);
      expect(directive).toBe(null);
    });
    it('should return the correct @rest directive when it is present', () => {
      const query = parse(`
          {
            user @rest(type: "User", path: "/users/:id", endpoint: "userAPI") {
              id
              name
            }
          }
        `);

      const directive = getRestDirective(query);
      expect(directive).toEqual({
        type: 'User',
        path: '/users/:id',
        endpoint: 'userAPI',
      });
    });
    it('should only return the first @rest directive when multiple are present', () => {
      const query = parse(`
          {
            user @rest(type: "User", path: "/users/:id", endpoint: "userAPI") {
              id
              name
              friends @rest(type: "Friend", path: "/friends/:id")
            }
          }
        `);

      const directive = getRestDirective(query);
      expect(directive).toEqual({
        type: 'User',
        path: '/users/:id',
        endpoint: 'userAPI',
      });
    });
  });

  describe('addTypename', () => {
    it('should add __typename to the data', () => {
      const mockQuery: DocumentNode = parse(`
        query {
          user @rest(type: "User", path: "/users/1") {
            id
            name
          }
        }
      `);
      const mockData: Result = { id: 1, name: 'Alice' };
      addTypename(mockData, 'User', mockQuery);
      expect(mockData.__typename).toBe('User');
    });

    it('should add __typename to nested fields', () => {
      const mockQuery: DocumentNode = parse(`
          query {
            user @rest(type: "User", path: "/users/1") {
              id
              name
              address @type(name: "Address") {
                city
                country
              }
            }
          }
        `);
      const mockData: Result = {
        id: 1,
        name: 'Alice',
        address: { city: 'Wonderland', country: 'Fantasy' },
      };
      addTypename(mockData, 'User', mockQuery);
      expect(mockData.address.__typename).toBe('Address');
    });

    it('should add __typename to an array of fields', () => {
      const mockQuery: DocumentNode = parse(`
          query {
            users @rest(type: "[User]", path: "/users") {
            __typename
              id
              name
            }
          }
        `);
      const mockData: Result = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      addTypename(mockData, 'User', mockQuery);
      mockData.forEach(user => {
        expect(user.__typename).toBe('User');
      });
    });

    it('should handle multiple nested levels', () => {
      const mockQuery: DocumentNode = parse(`
          query {
            user @rest(type: "User", path: "/users/1") {
              id
              name
              address {
                city
                country
                landmarks @type(name: "Landmark") {
                  name
                }
              }
            }
          }
        `);
      const mockData: Result = {
        id: 1,
        name: 'Alice',
        address: {
          city: 'Wonderland',
          country: 'Fantasy',
          landmarks: [{ name: 'Castle' }, { name: 'River' }],
        },
      };
      addTypename(mockData, 'User', mockQuery);
      expect(mockData.address.landmarks[0].__typename).toBe('Landmark');
      expect(mockData.address.landmarks[1].__typename).toBe('Landmark');
    });
  });

  describe('getTypeFromQuery', () => {
    it('should return the type for a given field', () => {
      const mockQuery: DocumentNode = parse(`
        query {
          user @rest(type: "User", path: "/users/1") {
            id
            name
            profile @type(name: "Profile") {
              avatar
            }
          }
        }
      `);
      expect(getTypeFromQuery(mockQuery, 'profile')).toBe('Profile');
    });

    it('should return the type for nested fields', () => {
      const mockQuery: DocumentNode = parse(`
          query {
            user @rest(type: "User", path: "/users/1") {
              id
              name
              profile @type(name: "Profile") {
                avatar
                details @type(name: "Details") {
                  age
                }
              }
            }
          }
        `);
      expect(getTypeFromQuery(mockQuery, 'details')).toBe('Details');
    });

    it('should return the type for arrays of fields', () => {
      const mockQuery: DocumentNode = parse(`
          query {
            users @rest(type: "[User]", path: "/users") {
              id
              name
              friends @type(name: "Friend") {
                id
                name
              }
            }
          }
        `);
      expect(getTypeFromQuery(mockQuery, 'friends')).toBe('Friend');
    });

    it('should return null for fields without the @type directive', () => {
      const mockQuery: DocumentNode = parse(`
          query {
            user @rest(type: "User", path: "/users/1") {
              id
              name
              profile {
                avatar
              }
            }
          }
        `);
      expect(getTypeFromQuery(mockQuery, 'profile')).toBeNull();
    });

    it('should return null for missing fields', () => {
      const mockQuery: DocumentNode = parse(`
          query {
            user @rest(type: "User", path: "/users/1") {
              id
              name
            }
          }
        `);
      expect(getTypeFromQuery(mockQuery, 'missingField')).toBeNull();
    });
  });

  describe('getTypeDirectiveForField', () => {
    it('should return the type for a basic field', () => {
      const mockQuery = parse(`
        query {
          user @type(name: "User") {
            id
            name
          }
        }
      `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'user'
        )
      ).toBe('User');
    });

    it('should return the type for nested fields', () => {
      const mockQuery = parse(`
        query {
          user {
            profile @type(name: "Profile") {
              avatar
            }
          }
        }
      `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'profile'
        )
      ).toBe('Profile');
    });

    it('should return the correct type when multiple fields have the same name', () => {
      const mockQuery = parse(`
        query {
          user @type(name: "User") {
            friend @type(name: "Friend") {
              user @type(name: "UserInner") {
                id
              }
            }
          }
        }
      `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'user'
        )
      ).toBe('User');
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'friend'
        )
      ).toBe('Friend');
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (
            mockQuery.definitions[0].selectionSet
              .selections[0] as FragmentDefinitionNode
          ).selectionSet,
          'user'
        )
      ).toBe('UserInner');
    });

    it('should return null for fields without the @type directive', () => {
      const mockQuery = parse(`
        query {
          user {
            id
            name
          }
        }
      `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'user'
        )
      ).toBeNull();
    });

    it('should return the correct type when field has multiple directives', () => {
      const mockQuery = parse(`
        query {
          user @otherDirective @type(name: "User") {
            id
            name
          }
        }
      `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'user'
        )
      ).toBe('User');
    });

    it('should return null for fields with the @type directive but missing name argument', () => {
      const mockQuery = parse(`
        query {
          user @type {
            id
            name
          }
        }
      `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'user'
        )
      ).toBeNull();
    });

    it('should return null for the absence of desired field in the query', () => {
      const mockQuery = parse(`
        query {
          user {
            id
            name
          }
        }
      `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'missingField'
        )
      ).toBeNull();
    });

    it('should return null for nested fields with the @type directive but missing name argument', () => {
      const mockQuery = parse(`
          query {
            user {
              profile @type {
                avatar
              }
            }
          }
        `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'profile'
        )
      ).toBeNull();
    });

    it('should return the correct type for fields within inline fragments', () => {
      const mockQuery = parse(`
          query {
            user {
              ... on UserType {
                profile @type(name: "Profile") {
                  avatar
                }
              }
            }
          }
        `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'profile'
        )
      ).toBe('Profile');
    });

    it('should handle fragment spreads correctly', () => {
      const mockQuery = parse(`
          query {
            user {
              ...userFields
            }
          }

          fragment userFields on User {
            profile @type(name: "Profile") {
              avatar
            }
          }
        `);
      // Assuming the function can handle fragment spreads
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'profile'
        )
      ).toBe('Profile');
    });

    it('should not mistake variables for type directive', () => {
      const mockQuery = parse(`
          query getUser($type: String!) {
            user @type(name: $type) {
              id
              name
            }
          }
        `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'user'
        )
      ).toBeNull();
    });

    it('should return the closest match for nested fields with the same name', () => {
      const mockQuery = parse(`
          query {
            user {
              friend {
                user @type(name: "UserInner") {
                  user @type(name: "UserInnerMost") {
                    id
                  }
                }
              }
            }
          }
        `);
      const friendSelectionSet = (
        mockQuery.definitions[0] as FragmentDefinitionNode
      ).selectionSet.selections[0].selectionSet;
      expect(
        getTypeDirectiveForField(mockQuery, friendSelectionSet, 'user')
      ).toBe('UserInner');
    });

    it('should handle fields without a selection set', () => {
      const mockQuery = parse(`
          query {
            user @type(name: "User")
          }
        `);
      expect(
        getTypeDirectiveForField(
          mockQuery,
          (mockQuery.definitions[0] as FragmentDefinitionNode).selectionSet,
          'user'
        )
      ).toBe('User');
    });
  });

  describe('getRequestedFields', () => {
    it('should collect top-level fields', () => {
      const mockQuery: DocumentNode = parse(`
        query {
          user {
            id
            name
          }
        }
      `);

      const expected: FieldMap = {
        user: {
          id: {},
          name: {},
        },
      };

      const result = getRequestedFields(mockQuery);
      expect(result).toEqual(expected);
    });

    it('should collect nested fields', () => {
      const mockQuery: DocumentNode = parse(`
        query {
          user {
            id
            profile {
              avatar
              bio
            }
          }
        }
      `);

      const expected: FieldMap = {
        user: {
          id: {},
          profile: {
            avatar: {},
            bio: {},
          },
        },
      };

      const result = getRequestedFields(mockQuery);
      expect(result).toEqual(expected);
    });

    it('should handle FragmentSpread', () => {
      const mockQuery: DocumentNode = parse(`
        query {
          user {
            ...userFields
          }
        }

        fragment userFields on User {
          id
          name
        }
      `);

      const expected: FieldMap = {
        user: {
          id: {},
          name: {},
        },
      };

      const result = getRequestedFields(mockQuery);
      expect(result).toEqual(expected);
    });

    it('should handle InlineFragment', () => {
      const mockQuery: DocumentNode = parse(`
        query {
          entity {
            ... on User {
              id
              name
            }
          }
        }
      `);

      const expected: FieldMap = {
        entity: {
          id: {},
          name: {},
        },
      };

      const result = getRequestedFields(mockQuery);
      expect(result).toEqual(expected);
    });
  });

  describe('omitExtraFields', () => {
    it('should omit fields not requested in the query', () => {
      const mockQuery: DocumentNode = parse(`
      query {
        user {
          id
          name
        }
      }
    `);
      const mockData = {
        user: {
          id: 1,
          name: 'Alice',
          age: 25, // This field should be omitted
        },
      };

      const expected = {
        user: {
          id: 1,
          name: 'Alice',
        },
      };

      const result = omitExtraFields(mockData, mockQuery);
      expect(result).toEqual(expected);
    });

    it('should handle nested fields', () => {
      const mockQuery: DocumentNode = parse(`
      query {
        user {
          id
          profile {
            avatar
          }
        }
      }
    `);
      const mockData = {
        user: {
          id: 1,
          name: 'Alice', // This field should be omitted
          profile: {
            avatar: 'image.jpg',
            bio: 'A short bio...', // This field should be omitted
          },
        },
      };

      const expected = {
        user: {
          id: 1,
          profile: {
            avatar: 'image.jpg',
          },
        },
      };

      const result = omitExtraFields(mockData, mockQuery);
      expect(result).toEqual(expected);
    });

    it('should handle arrays of objects', () => {
      const mockQuery: DocumentNode = parse(`
      query {
        users {
          id
          name
        }
      }
    `);
      const mockData = {
        users: [
          { id: 1, name: 'Alice', age: 25 }, // age should be omitted
          { id: 2, name: 'Bob', age: 30 }, // age should be omitted
        ],
      };

      const expected = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      };

      const result = omitExtraFields(mockData, mockQuery);
      expect(result).toEqual(expected);
    });
  });

  describe('replaceParam', () => {
    it('should replace a named parameter in an endpoint', () => {
      const endpoint = '/users/:id/details';
      const name = 'id';
      const value = '123';

      const result = replaceParam(endpoint, name, value);
      expect(result).toBe('/users/123/details');
    });

    it('should return the original endpoint if name is undefined', () => {
      const endpoint = '/users/:id/details';

      const result = replaceParam(endpoint, undefined, '123');
      expect(result).toBe(endpoint);
    });

    it('should return the original endpoint if value is undefined', () => {
      const endpoint = '/users/:id/details';
      const name = 'id';

      const result = replaceParam(endpoint, name, undefined);
      expect(result).toBe(endpoint);
    });

    it('should handle multiple occurrences of the named parameter', () => {
      const endpoint = '/users/:id/details/:id';
      const name = 'id';
      const value = '123';

      const result = replaceParam(endpoint, name, value);
      expect(result).toBe('/users/123/details/123');
    });

    it('should not replace if named parameter does not exist', () => {
      const endpoint = '/users/details';
      const name = 'id';
      const value = '123';

      const result = replaceParam(endpoint, name, value);
      expect(result).toBe(endpoint);
    });
  });

  describe('pathBuilder', () => {
    it('should replace named parameters with values from variables object', () => {
      const path = '/users/:userId/posts/:postId';
      const variables = { userId: '123', postId: '456' };
      const result = pathBuilder(path, variables);
      expect(result).toBe('/users/123/posts/456');
    });

    it('should replace multiple occurrences of the same named parameter', () => {
      const path = '/users/:userId/posts/:userId';
      const variables = { userId: '123' };
      const result = pathBuilder(path, variables);
      expect(result).toBe('/users/123/posts/123');
    });

    it('should return the original path if no named parameters are present', () => {
      const path = '/users/posts';
      const variables = { userId: '123' };
      const result = pathBuilder(path, variables);
      expect(result).toBe('/users/posts');
    });

    it('should throw an error if not all named parameters have values', () => {
      const path = '/users/:userId/posts/:postId';
      const variables = { userId: '123' };
      expect(() => pathBuilder(path, variables)).toThrow(
        'Missing params to run query, specify it in the query params'
      );
    });

    it('should not modify unnamed parameters', () => {
      const path = '/users/123:/posts/456:';
      const variables = { userId: '123', postId: '456' };
      expect(() => pathBuilder(path, variables)).toThrowError(
        'Missing params to run query, specify it in the query params'
      );
    });
  });

  describe('validateRequestMethodForOperationType', () => {
    describe('QUERY operations', () => {
      it('should not throw an error for GET method', () => {
        expect(() =>
          validateRequestMethodForOperationType('GET', 'query')
        ).not.toThrow();
      });

      it('should throw an error for non-GET methods', () => {
        ['POST', 'PUT', 'PATCH', 'DELETE', 'OTHER'].forEach(method => {
          expect(() =>
            validateRequestMethodForOperationType(method, 'query')
          ).toThrow(
            `A "query" operation can only support "GET" requests but got "${method}".`
          );
        });
      });
    });

    describe('MUTATION operations', () => {
      it('should not throw an error for POST, PUT, PATCH, DELETE methods', () => {
        ['POST', 'PUT', 'PATCH', 'DELETE'].forEach(method => {
          expect(() =>
            validateRequestMethodForOperationType(method, 'mutation')
          ).not.toThrow();
        });
      });

      it('should throw an error for unsupported methods', () => {
        ['GET', 'OTHER'].forEach(method => {
          expect(() =>
            validateRequestMethodForOperationType(method, 'mutation')
          ).toThrow('"mutation" operations do not support that HTTP-verb');
        });
      });
    });

    describe('SUBSCRIPTION operations', () => {
      it('should always throw an error', () => {
        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OTHER'].forEach(method => {
          expect(() =>
            validateRequestMethodForOperationType(method, 'subscription')
          ).toThrow('A "subscription" operation is not supported yet.');
        });
      });
    });

    describe('Other operations', () => {
      it('should return the operation type as is', () => {
        const otherOperation = 'OTHER' as any;
        expect(
          validateRequestMethodForOperationType('GET', otherOperation)
        ).toBe(otherOperation);
      });
    });
  });

  describe('getURIFromEndpoints', () => {
    const DEFAULT_ENDPOINT_KEY = '';
    const CUSTOM_ENDPOINT_KEY = 'custom';
    const DEFAULT_URI = 'https://default.com/api';
    const CUSTOM_URI = 'https://custom.com/api';

    const endpoints = {
      [DEFAULT_ENDPOINT_KEY]: DEFAULT_URI,
      [CUSTOM_ENDPOINT_KEY]: CUSTOM_URI,
    };

    it('should return the default URI when no endpoint is specified', () => {
      expect(getURIFromEndpoints(endpoints)).toBe(DEFAULT_URI);
    });

    it('should return the default URI when a non-existent endpoint is specified', () => {
      expect(getURIFromEndpoints(endpoints, 'nonexistent')).toBe(DEFAULT_URI);
    });

    it('should return the URI for the specified endpoint when it exists', () => {
      expect(getURIFromEndpoints(endpoints, CUSTOM_ENDPOINT_KEY)).toBe(
        CUSTOM_URI
      );
    });

    it('should return undefined when there is no default endpoint and no endpoint is specified', () => {
      expect(getURIFromEndpoints({})).toBeUndefined();
    });
  });
});
