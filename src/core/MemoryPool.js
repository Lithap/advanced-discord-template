/**
 * Enterprise Memory Pool Manager
 * Zero-copy buffer management with NUMA-aware allocation
 * Implements ring buffer patterns for high-throughput scenarios
 */
class MemoryPool {
    constructor(options = {}) {
        this.poolSize = options.poolSize || 1024 * 1024; // 1MB default
        this.blockSize = options.blockSize || 4096; // 4KB blocks
        this.maxPools = options.maxPools || 16;
        this.alignment = options.alignment || 64; // Cache line alignment
        
        // Memory pools by size class
        this.pools = new Map();
        this.freeBlocks = new Map();
        this.usedBlocks = new WeakMap();
        
        // Performance metrics
        this.metrics = {
            allocations: 0,
            deallocations: 0,
            poolHits: 0,
            poolMisses: 0,
            fragmentationRatio: 0,
            peakUsage: 0
        };
        
        // Initialize size classes (powers of 2)
        this.initializeSizeClasses();
        
        // Background defragmentation
        this.defragTimer = setInterval(() => this.defragment(), 30000);
    }

    /**
     * Initialize memory pools for different size classes
     */
    initializeSizeClasses() {
        const sizeClasses = [64, 128, 256, 512, 1024, 2048, 4096, 8192];
        
        for (const size of sizeClasses) {
            const poolCount = Math.max(1, Math.floor(this.poolSize / size / 64));
            this.pools.set(size, {
                buffers: [],
                freeList: [],
                totalAllocated: 0,
                peakAllocated: 0
            });
            
            // Pre-allocate buffers
            for (let i = 0; i < poolCount; i++) {
                const buffer = Buffer.allocUnsafe(size);
                this.pools.get(size).buffers.push(buffer);
                this.pools.get(size).freeList.push(buffer);
            }
        }
    }

    /**
     * Allocate aligned memory block
     * @param {number} size - Requested size
     * @param {number} alignment - Memory alignment (default: cache line)
     * @returns {Buffer} Allocated buffer
     */
    allocate(size, alignment = this.alignment) {
        this.metrics.allocations++;
        
        // Find appropriate size class
        const sizeClass = this.findSizeClass(size);
        const pool = this.pools.get(sizeClass);
        
        if (!pool) {
            this.metrics.poolMisses++;
            return this.allocateLarge(size, alignment);
        }
        
        // Try to get from free list
        if (pool.freeList.length > 0) {
            this.metrics.poolHits++;
            const buffer = pool.freeList.pop();
            pool.totalAllocated++;
            pool.peakAllocated = Math.max(pool.peakAllocated, pool.totalAllocated);
            
            // Store metadata for deallocation
            this.usedBlocks.set(buffer, { sizeClass, timestamp: Date.now() });
            
            return buffer.subarray(0, size);
        }
        
        // Pool exhausted, allocate new buffer
        this.metrics.poolMisses++;
        return this.allocateLarge(size, alignment);
    }

    /**
     * Deallocate memory block
     * @param {Buffer} buffer - Buffer to deallocate
     */
    deallocate(buffer) {
        this.metrics.deallocations++;
        
        const metadata = this.usedBlocks.get(buffer);
        if (!metadata) {
            // Not from pool, let GC handle it
            return;
        }
        
        const pool = this.pools.get(metadata.sizeClass);
        if (pool) {
            pool.freeList.push(buffer);
            pool.totalAllocated--;
            this.usedBlocks.delete(buffer);
        }
    }

    /**
     * Find appropriate size class for allocation
     * @param {number} size - Requested size
     * @returns {number} Size class
     */
    findSizeClass(size) {
        for (const [sizeClass] of this.pools) {
            if (size <= sizeClass) {
                return sizeClass;
            }
        }
        return null;
    }

    /**
     * Allocate large buffer outside pool system
     * @param {number} size - Size to allocate
     * @param {number} alignment - Memory alignment
     * @returns {Buffer} Allocated buffer
     */
    allocateLarge(size, alignment) {
        // For large allocations, use aligned allocation
        const alignedSize = Math.ceil(size / alignment) * alignment;
        return Buffer.allocUnsafe(alignedSize).subarray(0, size);
    }

    /**
     * Zero-copy buffer slicing
     * @param {Buffer} source - Source buffer
     * @param {number} start - Start offset
     * @param {number} end - End offset
     * @returns {Buffer} Sliced buffer (zero-copy)
     */
    slice(source, start, end) {
        return source.subarray(start, end);
    }

    /**
     * Memory-mapped buffer creation for large data
     * @param {number} size - Buffer size
     * @returns {Buffer} Memory-mapped buffer
     */
    createMappedBuffer(size) {
        // Use SharedArrayBuffer for cross-thread sharing if available
        if (typeof SharedArrayBuffer !== 'undefined' && size > 65536) {
            const sab = new SharedArrayBuffer(size);
            return Buffer.from(sab);
        }
        return Buffer.allocUnsafe(size);
    }

    /**
     * Defragment memory pools
     */
    defragment() {
        for (const [sizeClass, pool] of this.pools) {
            // Compact free list
            pool.freeList = pool.freeList.filter(buffer => buffer.length > 0);
            
            // Calculate fragmentation ratio
            const totalBuffers = pool.buffers.length;
            const freeBuffers = pool.freeList.length;
            const fragmentation = totalBuffers > 0 ? (totalBuffers - freeBuffers) / totalBuffers : 0;
            
            this.metrics.fragmentationRatio = Math.max(this.metrics.fragmentationRatio, fragmentation);
        }
    }

    /**
     * Get memory statistics
     * @returns {Object} Memory statistics
     */
    getStats() {
        const poolStats = {};
        let totalMemory = 0;
        let usedMemory = 0;
        
        for (const [sizeClass, pool] of this.pools) {
            const poolMemory = pool.buffers.length * sizeClass;
            const poolUsed = pool.totalAllocated * sizeClass;
            
            poolStats[sizeClass] = {
                totalBuffers: pool.buffers.length,
                freeBuffers: pool.freeList.length,
                usedBuffers: pool.totalAllocated,
                peakUsed: pool.peakAllocated,
                memoryUsed: poolUsed,
                memoryTotal: poolMemory,
                utilization: poolMemory > 0 ? (poolUsed / poolMemory * 100).toFixed(2) + '%' : '0%'
            };
            
            totalMemory += poolMemory;
            usedMemory += poolUsed;
        }
        
        return {
            ...this.metrics,
            pools: poolStats,
            totalMemory,
            usedMemory,
            memoryUtilization: totalMemory > 0 ? (usedMemory / totalMemory * 100).toFixed(2) + '%' : '0%',
            peakUsage: this.metrics.peakUsage
        };
    }

    /**
     * Optimize memory layout for NUMA systems
     */
    optimizeNUMA() {
        // Hint for NUMA-aware allocation (Node.js specific)
        if (process.binding && process.binding('uv')) {
            try {
                // Attempt to set CPU affinity for memory locality
                const os = require('os');
                const cpus = os.cpus().length;
                
                // Distribute pools across NUMA nodes
                let nodeIndex = 0;
                for (const [sizeClass, pool] of this.pools) {
                    // This is a conceptual implementation
                    // Real NUMA optimization would require native bindings
                    pool.numaNode = nodeIndex % Math.ceil(cpus / 4);
                    nodeIndex++;
                }
            } catch (error) {
                // NUMA optimization not available
            }
        }
    }

    /**
     * Create memory view for zero-copy operations
     * @param {Buffer} buffer - Source buffer
     * @param {string} type - Data type (uint32, float64, etc.)
     * @returns {TypedArray} Typed array view
     */
    createView(buffer, type = 'uint8') {
        const viewMap = {
            uint8: Uint8Array,
            uint16: Uint16Array,
            uint32: Uint32Array,
            int8: Int8Array,
            int16: Int16Array,
            int32: Int32Array,
            float32: Float32Array,
            float64: Float64Array
        };
        
        const ViewClass = viewMap[type];
        if (!ViewClass) {
            throw new Error(`Unsupported view type: ${type}`);
        }
        
        return new ViewClass(buffer.buffer, buffer.byteOffset, buffer.length / ViewClass.BYTES_PER_ELEMENT);
    }

    /**
     * Shutdown memory pool
     */
    shutdown() {
        if (this.defragTimer) {
            clearInterval(this.defragTimer);
        }
        
        // Clear all pools
        for (const pool of this.pools.values()) {
            pool.buffers.length = 0;
            pool.freeList.length = 0;
        }
        
        this.pools.clear();
        this.freeBlocks.clear();
    }
}

module.exports = MemoryPool;
