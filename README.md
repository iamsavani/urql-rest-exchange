# `urql-rest-exchange`

A custom exchange for `urql` that supports GraphQL queries/mutations via REST endpoints using a directive-based approach.

## Installation

```
npm install urql-rest-exchange
```

or

```
yarn add urql-rest-exchange
```

## Features

- Easy integration with your existing `urql` client setup.
- Use GraphQL to fetch from RESTful APIs.
- Supports multiple endpoints with a default.
- Easily configurable serializers for request bodies.
- Automatic insertion of `__typename` based on directives.

## Usage

```javascript
import {
  Client,
  dedupExchange,
  cacheExchange,
  fetchExchange,
} from '@urql/core';
import { restExchange } from 'urql-rest-exchange';

const client = new Client({
  url: 'http://localhost:4000/graphql', // this remains your GraphQL server URL
  exchanges: [
    dedupExchange,
    cacheExchange,
    restExchange({
      endpoints: {
        users: 'https://api.example.com/users',
        posts: 'https://api.example.com/posts',
      },
    }),
    fetchExchange,
  ],
});
```

When writing your GraphQL queries, use the `@rest` directive to specify REST endpoint details:

```graphql
query GetUser($id: ID!) {
  user(id: $id) @rest(type: "User", endpoint: "users", path: "/:id") {
    id
    name
  }
}
```

## Configuration

The `restExchange` accepts the following options:

- `endpoints`: An object mapping endpoint keys to URLs.
- `uri`: A default URI if one isn't provided in the `@rest` directive.
- `bodySerializers`: Custom serializers to use for request bodies.

## Configuration Details

### `endpoints`

An object that maps symbolic keys to full endpoint URLs. This helps in abstracting the actual URLs and provides a way to quickly switch between different environments or services without changing your GraphQL queries.

**Example**:

```javascript
endpoints: {
  users: 'https://api.example.com/users',
  products: 'https://api.shop.com/products',
}
```

In your GraphQL queries, you can then refer to these endpoints using the symbolic key:

```graphql
{
  user(id: 1) @rest(endpoint: "users", type: "User") {...}
  product(id: 42) @rest(endpoint: "products", type: "Product") {...}
}
```

### `uri`

A default base URI that will be used if an `endpoint` isn't specified in the `@rest` directive. This is useful for scenarios where most of your REST requests go to a common base URL.

**Example**:

```javascript
uri: 'https://api.default.com';
```

### `bodySerializers`

This is an object mapping keys to custom serialization functions. These functions will be invoked to transform GraphQL variables into a format suitable for the REST endpoint's request body.

Each serializer function receives two arguments:
1. `data`: The GraphQL variables that need serialization.
2. `headers`: The current set of HTTP headers that will be sent with the request. This provides an opportunity to adjust or add headers based on the serialized data.

The function should return an object with two properties:
- `body`: The serialized data (usually an object, string, FormData, etc.).
- `headers`: The possibly updated set of HTTP headers.

**Example**:

```javascript
bodySerializers: {
  formData: (data, headers) => {
    const formData = new FormData();
    Object.keys(data).forEach(key => {
      formData.append(key, data[key]);
    });
    // For FormData, we might want to set the 'Content-Type' header
    headers['Content-Type'] = 'multipart/form-data';
    return {
      body: formData,
      headers: headers
    };
  }
}
```

In the GraphQL mutation, you can specify which serializer to use:

```graphql
mutation CreateUser($input: UserInput!) @rest(endpoint: "users", method: "POST", bodySerializer: "formData") {
  ...
}
```


## Directives


#### `@rest`


The main directive used to indicate that a field in a GraphQL query or mutation should be fetched from a REST endpoint.

- `endpoint`: The key from the `endpoints` configuration. Specifies which REST endpoint URL to use.
- `path`: A path appended to the endpoint URL. Useful for REST endpoints with dynamic segments. E.g., `"/:id"`.
- `method`: HTTP method (e.g., `'GET'`, `'POST'`, `'PUT'`). Default is `'GET'`.
- `bodyKey`: If the body of your REST request relies on a specific key from the GraphQL variables, specify that key with `bodyKey`.
- `type`: This specifies the `__typename` to be added to the response. Useful for client-side caching strategies.
- `bodySerializer`: The key for the serialization function defined in `bodySerializers`. Specifies how the GraphQL variables should be transformed for the request body.


### `bodyKey`

In the context of `urql-rest-exchange`, when integrating GraphQL with RESTful operations, it's common to use GraphQL variables to pass data along with your queries or mutations. These variables might need to be mapped or transformed to match the body structure expected by the REST endpoint.

The `bodyKey` configuration option plays a crucial role here, allowing you to specify which GraphQL variable should be used as the main body of the REST request for operations other than GET and DELETE.

#### How It Works:

When you make a POST, PUT, or any other type of request that requires a body, the exchange will check for the presence of `bodyKey`. If it finds the specified key within your GraphQL variables, it will take the associated value and use it as the request body. If `bodyKey` isn't provided, by default, the value associated with the `input` key from the variables will be used.

#### Example Usage:

Imagine you have the following GraphQL mutation:

```graphql
mutation UpdatePost($postId: ID!, $input: PostInput!) @rest(endpoint: "posts/$postId", method: "PUT", bodyKey: "input") {
  ...
}
```

With these variables:

```javascript
{
  postId: '123',
  input: {
    title: 'New Post',
    content: 'This is a new post.'
  }
}
```

For this mutation, because `bodyKey` is set to `"input"`, the REST request made to the `posts/123` endpoint would have a body containing the title and content specified in the `input` variable.

However, if in a different scenario you used:

```graphql
mutation UpdatePost($postId: ID!, $data: PostInput!) @rest(endpoint: "posts/$postId", method: "PUT", bodyKey: "data") {
  ...
}
```

Then the value associated with the `data` variable would be used as the request body instead.




#### When To Use:

1. **Specific Body Requirements**: If your REST API expects a particular structure or value directly in the request body, `bodyKey` helps in mapping the GraphQL variables correctly.
2. **Flexibility in GraphQL Variables**: For scenarios where you might have multiple potential variables and you want to decide which one to send as the main body.

#### Note:

It's essential to ensure the GraphQL variable selected via `bodyKey` is structured in a way that's compatible with what your REST API expects.


### Using the `@type` Directive for Typename Patching

In GraphQL, when integrating with a RESTful service using the `@rest` directive, it's often necessary to specify the GraphQL object type for the response data. This is achieved by setting the `__typename` attribute. While the outer response object's typename can be set using the `type` parameter of the `@rest` directive, there might be a need to specify the typenames for nested objects within the response.

#### Example:

Consider the following GraphQL query:

```graphql
query GetUserWithPosts {
  user @rest(type: "UserPayload", path: "users/123") {
    id
    name
    posts {
      title
      content
      date
    }
  }
}
```

In this query, the `@rest` directive indicates that the outer object (in this case, `data.user`) should have a `__typename` of `UserPayload`. However, what if you also need to set the typename for the nested `posts` array?

This is where the `@type` directive comes into play:

```graphql
query GetUserWithPosts {
  user @rest(type: "UserPayload", path: "users/123") {
    id
    name
    posts @type(name: "Post") {
      title
      content
      date
    }
  }
}
```

By adding `@type(name: "Post")` to the `posts` field, each object within the `posts` array will have a `__typename` of `Post`.

### When to Use the `@type` Directive:

The `@type` directive is particularly useful for lightweight REST integrations where you have a limited number of nested objects in your response and you wish to specify their GraphQL object types.

However, it's important to note the limitations:

- **Verbosity**: Each query dealing with nested objects will need to include the `@type` directive, making the queries longer.

- **Potential for Errors**: The need to manually add the directive for nested objects can make it error-prone, especially if the data structure or the typenames change over time.

Despite these caveats, the `@type` directive provides a straightforward way to manage typenames for nested objects in the RESTful responses, ensuring your GraphQL client's cache functions efficiently and accurately.

---

## Limitations

- Currently, only supports REST endpoints returning JSON.
- Subscriptions are not supported.

## Contributing

If you'd like to contribute, please fork the repository and use a feature branch. Pull requests are warmly welcome.

## Licensing

The code in this project is licensed under MIT license.
