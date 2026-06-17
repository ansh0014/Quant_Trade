cmake_minimum_required(VERSION 3.15)
project(exchange_sim CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Release-optimised by default; add -g if you need debug symbols
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O2 -march=native -fno-exceptions -fno-rtti")

# ---- core-cpp (header-only interface library) --------------------------------
set(CORE_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../core-cpp")

add_library(hft_core INTERFACE)
target_include_directories(hft_core INTERFACE "${CORE_CPP_DIR}/include")

# ---- exchange_sim binary -----------------------------------------------------
add_executable(exchange_sim
    cmd/exchange/main.cpp
)

target_include_directories(exchange_sim PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
    "${CORE_CPP_DIR}/include"
)

target_link_libraries(exchange_sim PRIVATE hft_core)

# ---- install (optional) ------------------------------------------------------
install(TARGETS exchange_sim DESTINATION bin)
