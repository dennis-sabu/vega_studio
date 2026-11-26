# Portable Makefile for VEGA ARIES V3 starter project
# Host-specific SDK/toolchain directories are supplied by VEGA Studio from Phase 6 SDK Config.

CROSS_COMPILE ?= riscv32-vega-elf
RISCV_ARCH    ?= rv32i_zicsr
VEGA_MACHINE  ?= THEJAS32

CC       := $(CROSS_COMPILE)-gcc
SRC_DIR  := src
INC_DIR  := include
BUILD_DIR := build

CFLAGS := -march=$(RISCV_ARCH) -mabi=ilp32 -Os -Wall -Wextra -ffreestanding -I$(INC_DIR)

.PHONY: all clean info

all: info
	@echo "Toolchain prefix: $(CROSS_COMPILE) | Machine: $(VEGA_MACHINE) | Arch: $(RISCV_ARCH)"
	@mkdir -p $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $(SRC_DIR)/main.c -o $(BUILD_DIR)/main.o
	@echo "Compiled object: $(BUILD_DIR)/main.o (link with your VEGA SDK crt0/linker script for flashing)."

info:
	@echo "Building minimal_c_entry for $(VEGA_MACHINE)"

clean:
	rm -rf $(BUILD_DIR)
