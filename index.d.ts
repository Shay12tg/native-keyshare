declare module 'native-keyshare' {
    /**
     * Stores an object that can be accessed from any worker thread
     * @param key The key to store the object under
     * @param value The object to store
     */
    export function set(key: string, value: object): void;

    /**
     * Retrieves a previously stored object
     * @param key The key of the object to retrieve
     * @returns The stored object or null if not found
     */
    export function get(key: string): object | null;

    /**
     * Removes all stored objects
     */
    export function clear(): void;
} 