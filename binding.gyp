{
    "targets": [{
        "target_name": "shared_object",
        "sources": ["shared_object.cc"],
        "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")",
            "/opt/homebrew/include",
            "/opt/homebrew/include/node/"
        ],
        "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
        "defines": ["NAPI_CPP_EXCEPTIONS"],
        "cflags!": ["-fno-exceptions"],
        "cflags_cc!": ["-fno-exceptions"],
        "cflags_cc": [
            "-std=c++17",
            "-O3",
            "-march=native",
            "-mtune=native",
            "-flto",
            "-ffast-math",
            "-funroll-loops",
            "-fomit-frame-pointer",
            "-finline-functions",
            "-pthread"   
        ],
        "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "14",
            "OTHER_CPLUSPLUSFLAGS": [
                "-std=c++17",
                "-O3",
                "-march=native",
                "-mtune=native",
                "-flto",
                "-ffast-math",
                "-funroll-loops",
                "-fomit-frame-pointer",
                "-finline-functions",
                "-pthread"   
            ],
            "OTHER_LDFLAGS": ["-flto"]
        },
        "msvs_settings": {
            "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": [
                    "/O2",
                    "/arch:AVX2",
                    "/GL",
                    "/std:c++17"
                ]
            },
            "VCLinkerTool": {
                "LinkTimeCodeGeneration": 1
            }
        }
    }]
}