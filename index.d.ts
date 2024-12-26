declare module 'native-keyshare' {
    interface SetOptions {
        immutable?: boolean;
        minBufferSize?: number;
        ttl?: number | undefined;
        skipLock?: boolean;
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
         * @param skipLock - Optional boolean if skip the lock.
         * @returns The associated value, or `undefined` if the key does not exist.
         */
        get<T = any>(key: string, skipLock = false): T | undefined;

        /**
         * Deletes a key-value pair from the store.
         * @param key - The key to delete.
         * @returns `true` if the key was deleted, otherwise `false`.
         */
        delete(key: string): boolean;

        /**
         * List all keys in store.
         * @param pattern - Optional pattern.
         * @returns array of keys.
         */
        listKeys(pattern?: string): string[];

        /**
         * Lock a key in store.
         * @param key - The key to lock.
         * @param timeout - Optional timeout (in ms. defualt 1000).
         * @returns true if locked.
         */
        lock(key: string, timeout: number = 1000): boolean;

        /**
         * Release locked key in store.
         * @param key - Release a lock.
         * @returns true if released.
         */
        release(key: string): boolean;

        /**
         * Clear the store.
         */
        clear(): void;

        /**
         * Close the store. cleanup local maps and buffer references.
         */
        close(): void;
    }

    /**
     * Creates a new shared key-value store.
     * @param parentPort - The parent port for the worker thread.
     * @returns An instance of `ISharedKVStore`.
     */
    export function createStore(parentPort?: MessagePort | null): ISharedKVStore;
}