CROSS_COMPILE ?= riscv32-vega-elf
RISCV_ARCH    ?= rv32i_zicsr
VEGA_MACHINE  ?= THEJAS32

CC        := $(CROSS_COMPILE)-gcc
BUILD_DIR := build
CFLAGS    := -march=$(RISCV_ARCH) -mabi=ilp32 -Os -Wall -Wextra

.PHONY: all clean
all:
	@mkdir -p $(BUILD_DIR)
	$(CC) $(CFLAGS) -c src/main.c -o $(BUILD_DIR)/main.o
clean:
	rm -rf $(BUILD_DIR)
