declare module 'native-keyshare' {
    interface SetOptions {
        immutable?: boolean;
        minBufferSize?: number;
        ttl?: number | undefined;
    }

    // Shared key-value store interface
    interface ISharedKVStore {
        /**
         * Sets a key-value pair in the store.
         * @param key - The key to set.
         * @param value - The value to associate with the key.
         * @param options - Optional SetOptions.
         * @returns `true` if the operation is successful, otherwise `false`.
         */
        set(key: string, value: any, options: SetOptions = {}): boolean;

        /**
         * Gets the value associated with a key.
         * @param key - The key to retrieve.
         * @returns The associated value, or `undefined` if the key does not exist.
         */
        get<T = any>(key: string): T | undefined;

        /**
         * Deletes a key-value pair from the store.
         * @param key - The key to delete.
         * @returns `true` if the key was deleted, otherwise `false`.
         */
        delete(key: string): boolean;

        /**
         * Clear the store.
         */
        clear(): void

        /**
         * Close the store. cleanup local maps and buffer references.
         */
        close(): void
    }

    /**
     * Creates a new shared key-value store.
     * @param parentPort - The parent port for the worker thread.
     * @returns An instance of `ISharedKVStore`.
     */
    export function createStore(parentPort?: MessagePort | null): ISharedKVStore;
}