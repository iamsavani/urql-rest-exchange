import {
  hasRestDirective,
  getRestDirective,
  addTypename,
  getTypeFromQuery,
} from './restExchange';
import { DocumentNode, parse } from 'graphql';
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
});
