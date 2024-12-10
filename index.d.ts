declare module 'native-keyshare' {
    // Shared key-value store interface
    interface ISharedKVStore {
        /**
         * Sets a key-value pair in the store.
         * @param key - The key to set.
         * @param value - The value to associate with the key.
         * @param resizeBuffer - Whether to resize the buffer if necessary.
         * @returns `true` if the operation is successful, otherwise `false`.
         */
        set(key: string, value: any, resizeBuffer?: boolean): boolean;

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
    }

    /**
     * Creates a new shared key-value store.
     * @param parentPort - The parent port for the worker thread.
     * @returns An instance of `ISharedKVStore`.
     */
    export function createStore(parentPort?: MessagePort | null): ISharedKVStore;
}