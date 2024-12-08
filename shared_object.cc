#include <napi.h>
#include <unordered_map>
#include <string>
#include <shared_mutex>
#include <memory>
#include <atomic>

struct alignas(64) CachedObject {
    std::string serialized;
    Napi::ObjectReference deserialized;
    std::atomic<bool> is_deserialized;

    explicit CachedObject(std::string&& ser) 
        : serialized(std::move(ser)), is_deserialized(false) {}
};

class alignas(64) SharedObjectStore {
public:
    static SharedObjectStore& Instance() {
        static SharedObjectStore instance;
        return instance;
    }

    void Set(const std::string& key, const Napi::Value& value) {
        std::unique_lock<std::shared_mutex> lock(mutex_);
        
        Napi::Env env = value.Env();

        Napi::Object JSON = env.Global().Get("JSON").As<Napi::Object>();
        std::string serialized = JSON.Get("stringify")
            .As<Napi::Function>()
            .Call(JSON, {value})
            .As<Napi::String>()
            .Utf8Value();
        
        store_[key] = std::make_shared<CachedObject>(std::move(serialized));
    }

    Napi::Value Get(const std::string& key, const Napi::Env& env) {
        std::shared_lock<std::shared_mutex> lock(mutex_);
        
        auto it = store_.find(key);
        if (it == store_.end()) {
            return env.Null();
        }

        auto cached = it->second;
        
        if (!cached->is_deserialized.load(std::memory_order_acquire)) {
            Napi::EscapableHandleScope scope(env);
            
            Napi::Object JSON = env.Global().Get("JSON").As<Napi::Object>();
            Napi::Value deserialized = JSON.Get("parse")
                .As<Napi::Function>()
                .Call(JSON, {Napi::String::New(env, cached->serialized)});
            
            cached->deserialized = Napi::Persistent(deserialized.As<Napi::Object>());
            cached->deserialized.SuppressDestruct();
            cached->is_deserialized.store(true, std::memory_order_release);
            
            return scope.Escape(deserialized.As<Napi::Object>());
        }
        
        return cached->deserialized.Value();
    }

    void Clear() {
        std::unique_lock<std::shared_mutex> lock(mutex_);
        store_.clear();
    }

private:
    SharedObjectStore() = default;
    std::unordered_map<std::string, std::shared_ptr<CachedObject>> store_;
    alignas(64) std::shared_mutex mutex_;
};

Napi::Value SetObject(const Napi::CallbackInfo& info) {
    if (info.Length() < 2 || !info[0].IsString()) return info.Env().Undefined();

    std::string key = info[0].As<Napi::String>().Utf8Value();
    SharedObjectStore::Instance().Set(key, info[1]);
    return info.Env().Undefined();
}

Napi::Value GetObject(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return info.Env().Null();
    
    std::string key = info[0].As<Napi::String>().Utf8Value();
    return SharedObjectStore::Instance().Get(key, info.Env());
}

Napi::Value ClearObjects(const Napi::CallbackInfo& info) {
    SharedObjectStore::Instance().Clear();
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("set", Napi::Function::New(env, SetObject));
    exports.Set("get", Napi::Function::New(env, GetObject));
    exports.Set("clear", Napi::Function::New(env, ClearObjects));
    return exports;
}

NODE_API_MODULE(keystore, Init)