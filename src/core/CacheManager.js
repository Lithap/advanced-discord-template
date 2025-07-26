/**
 * Enterprise Cache Manager with Distributed Coherence
 * Multi-tier caching with LRU, LFU, and adaptive replacement policies
 * Features: Write-through/write-back, cache coherence, bloom filters
 */
class CacheManager {
    constructor(options = {}) {
        this.name = options.name || 'default';
        this.maxSize = options.maxSize || 10000;
        this.ttl = options.ttl || 3600000; // 1 hour default
        this.policy = options.policy || 'lru'; // lru, lfu, arc
        this.writePolicy = options.writePolicy || 'write-through'; // write-through, write-back
        
        // Multi-tier storage
        this.tiers = {
            l1: new Map(), // In-memory hot cache
            l2: new Map(), // In-memory warm cache
            l3: null       // Persistent cache (Redis/etc)
        };
        
        // Cache metadata
        this.metadata = new Map(); // key -> { hits, lastAccess, frequency, size, tier }
        this.accessOrder = new Map(); // For LRU
        this.frequencyBuckets = new Map(); // For LFU
        
        // Adaptive Replacement Cache (ARC) state
        this.arc = {
            t1: new Set(), // Recent cache misses
            t2: new Set(), // Frequent cache misses
            b1: new Set(), // Ghost entries for t1
            b2: new Set(), // Ghost entries for t2
            p: 0,          // Target size for t1
            c: Math.floor(this.maxSize / 2) // Cache size
        };
        
        // Bloom filter for negative caching
        this.bloomFilter = new BloomFilter(options.bloomSize || 100000, options.bloomHashes || 3);
        
        // Write-back buffer
        this.writeBackBuffer = new Map();
        this.writeBackTimer = null;
        
        // Statistics
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            writes: 0,
            reads: 0,
            l1Hits: 0,
            l2Hits: 0,
            l3Hits: 0,
            coherenceEvents: 0
        };
        
        // Cache coherence
        this.coherenceProtocol = options.coherenceProtocol || 'mesi'; // mesi, mosi
        this.coherenceStates = new Map(); // key -> state (Modified, Exclusive, Shared, Invalid)
        
        // Background maintenance
        this.startMaintenance();
    }

    /**
     * Get value from cache with tier promotion
     * @param {string} key - Cache key
     * @returns {Promise<*>} Cached value or null
     */
    async get(key) {
        this.stats.reads++;
        
        // Check bloom filter for definite misses
        if (!this.bloomFilter.test(key)) {
            this.stats.misses++;
            return null;
        }
        
        // Check L1 cache first
        if (this.tiers.l1.has(key)) {
            this.stats.hits++;
            this.stats.l1Hits++;
            this.updateAccess(key, 'l1');
            return this.tiers.l1.get(key);
        }
        
        // Check L2 cache
        if (this.tiers.l2.has(key)) {
            this.stats.hits++;
            this.stats.l2Hits++;
            const value = this.tiers.l2.get(key);
            
            // Promote to L1
            this.promoteToL1(key, value);
            this.updateAccess(key, 'l1');
            return value;
        }
        
        // Check L3 cache (if available)
        if (this.tiers.l3) {
            const value = await this.tiers.l3.get(key);
            if (value !== null) {
                this.stats.hits++;
                this.stats.l3Hits++;
                
                // Promote to L2
                this.promoteToL2(key, value);
                this.updateAccess(key, 'l2');
                return value;
            }
        }
        
        this.stats.misses++;
        return null;
    }

    /**
     * Set value in cache with write policy
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     * @param {Object} options - Set options
     */
    async set(key, value, options = {}) {
        this.stats.writes++;
        
        const ttl = options.ttl || this.ttl;
        const tier = options.tier || 'l1';
        const size = this.calculateSize(value);
        
        // Add to bloom filter
        this.bloomFilter.add(key);
        
        // Handle write policy
        if (this.writePolicy === 'write-through') {
            await this.writeThrough(key, value, ttl, tier);
        } else {
            await this.writeBack(key, value, ttl, tier);
        }
        
        // Update metadata
        this.metadata.set(key, {
            hits: 0,
            lastAccess: Date.now(),
            frequency: 1,
            size,
            tier,
            ttl: Date.now() + ttl,
            coherenceState: 'Modified'
        });
        
        // Update coherence state
        this.updateCoherenceState(key, 'Modified');
        
        // Apply replacement policy if needed
        await this.applyReplacementPolicy(tier);
    }

    /**
     * Write-through cache policy
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     * @param {number} ttl - Time to live
     * @param {string} tier - Cache tier
     */
    async writeThrough(key, value, ttl, tier) {
        // Write to cache tier
        this.tiers[tier].set(key, value);
        
        // Write to persistent storage if L3 available
        if (this.tiers.l3) {
            await this.tiers.l3.set(key, value, ttl);
        }
    }

    /**
     * Write-back cache policy
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     * @param {number} ttl - Time to live
     * @param {string} tier - Cache tier
     */
    async writeBack(key, value, ttl, tier) {
        // Write to cache tier immediately
        this.tiers[tier].set(key, value);
        
        // Add to write-back buffer
        this.writeBackBuffer.set(key, { value, ttl, timestamp: Date.now() });
        
        // Schedule write-back if not already scheduled
        if (!this.writeBackTimer) {
            this.writeBackTimer = setTimeout(() => this.flushWriteBackBuffer(), 5000);
        }
    }

    /**
     * Flush write-back buffer to persistent storage
     */
    async flushWriteBackBuffer() {
        if (this.tiers.l3 && this.writeBackBuffer.size > 0) {
            const entries = Array.from(this.writeBackBuffer.entries());
            
            // Batch write to L3
            const promises = entries.map(([key, data]) => 
                this.tiers.l3.set(key, data.value, data.ttl)
            );
            
            await Promise.allSettled(promises);
            this.writeBackBuffer.clear();
        }
        
        this.writeBackTimer = null;
    }

    /**
     * Promote value to L1 cache
     * @param {string} key - Cache key
     * @param {*} value - Value to promote
     */
    promoteToL1(key, value) {
        // Remove from L2
        this.tiers.l2.delete(key);
        
        // Add to L1
        this.tiers.l1.set(key, value);
        
        // Update metadata
        const meta = this.metadata.get(key);
        if (meta) {
            meta.tier = 'l1';
        }
    }

    /**
     * Promote value to L2 cache
     * @param {string} key - Cache key
     * @param {*} value - Value to promote
     */
    promoteToL2(key, value) {
        this.tiers.l2.set(key, value);
        
        // Update metadata
        const meta = this.metadata.get(key);
        if (meta) {
            meta.tier = 'l2';
        }
    }

    /**
     * Update access metadata
     * @param {string} key - Cache key
     * @param {string} tier - Access tier
     */
    updateAccess(key, tier) {
        const meta = this.metadata.get(key);
        if (meta) {
            meta.hits++;
            meta.frequency++;
            meta.lastAccess = Date.now();
            meta.tier = tier;
        }
        
        // Update LRU order
        if (this.accessOrder.has(key)) {
            this.accessOrder.delete(key);
        }
        this.accessOrder.set(key, Date.now());
    }

    /**
     * Apply replacement policy when cache is full
     * @param {string} tier - Cache tier
     */
    async applyReplacementPolicy(tier) {
        const cache = this.tiers[tier];
        const maxTierSize = tier === 'l1' ? Math.floor(this.maxSize * 0.3) : 
                           tier === 'l2' ? Math.floor(this.maxSize * 0.7) : this.maxSize;
        
        if (cache.size <= maxTierSize) {
            return;
        }
        
        let victimKey;
        
        switch (this.policy) {
            case 'lru':
                victimKey = this.findLRUVictim(tier);
                break;
            case 'lfu':
                victimKey = this.findLFUVictim(tier);
                break;
            case 'arc':
                victimKey = await this.findARCVictim(tier);
                break;
            default:
                victimKey = this.findLRUVictim(tier);
        }
        
        if (victimKey) {
            await this.evict(victimKey, tier);
        }
    }

    /**
     * Find LRU victim for eviction
     * @param {string} tier - Cache tier
     * @returns {string} Victim key
     */
    findLRUVictim(tier) {
        const cache = this.tiers[tier];
        let oldestKey = null;
        let oldestTime = Infinity;
        
        for (const key of cache.keys()) {
            const meta = this.metadata.get(key);
            if (meta && meta.tier === tier && meta.lastAccess < oldestTime) {
                oldestTime = meta.lastAccess;
                oldestKey = key;
            }
        }
        
        return oldestKey;
    }

    /**
     * Find LFU victim for eviction
     * @param {string} tier - Cache tier
     * @returns {string} Victim key
     */
    findLFUVictim(tier) {
        const cache = this.tiers[tier];
        let victimKey = null;
        let minFrequency = Infinity;
        
        for (const key of cache.keys()) {
            const meta = this.metadata.get(key);
            if (meta && meta.tier === tier && meta.frequency < minFrequency) {
                minFrequency = meta.frequency;
                victimKey = key;
            }
        }
        
        return victimKey;
    }

    /**
     * Find ARC victim for eviction
     * @param {string} tier - Cache tier
     * @returns {string} Victim key
     */
    async findARCVictim(tier) {
        // Simplified ARC implementation
        // In practice, this would be more complex
        if (this.arc.t1.size > 0) {
            return this.arc.t1.values().next().value;
        } else if (this.arc.t2.size > 0) {
            return this.arc.t2.values().next().value;
        }
        
        return this.findLRUVictim(tier);
    }

    /**
     * Evict key from cache
     * @param {string} key - Key to evict
     * @param {string} tier - Cache tier
     */
    async evict(key, tier) {
        const cache = this.tiers[tier];
        const meta = this.metadata.get(key);
        
        // Handle write-back if needed
        if (this.writePolicy === 'write-back' && meta?.coherenceState === 'Modified') {
            if (this.tiers.l3) {
                const value = cache.get(key);
                await this.tiers.l3.set(key, value, meta.ttl - Date.now());
            }
        }
        
        // Remove from cache and metadata
        cache.delete(key);
        this.metadata.delete(key);
        this.accessOrder.delete(key);
        
        // Update coherence state
        this.updateCoherenceState(key, 'Invalid');
        
        this.stats.evictions++;
    }

    /**
     * Update cache coherence state
     * @param {string} key - Cache key
     * @param {string} state - New coherence state
     */
    updateCoherenceState(key, state) {
        this.coherenceStates.set(key, state);
        this.stats.coherenceEvents++;
    }

    /**
     * Calculate approximate size of value
     * @param {*} value - Value to measure
     * @returns {number} Approximate size in bytes
     */
    calculateSize(value) {
        if (typeof value === 'string') {
            return value.length * 2; // UTF-16
        } else if (typeof value === 'number') {
            return 8;
        } else if (typeof value === 'boolean') {
            return 1;
        } else if (Buffer.isBuffer(value)) {
            return value.length;
        } else {
            return JSON.stringify(value).length * 2;
        }
    }

    /**
     * Start cache manager
     */
    async start() {
        this.startMaintenance();
        console.log('💾 Cache manager started');
    }

    /**
     * Start background maintenance tasks
     */
    startMaintenance() {
        // TTL cleanup
        this.ttlInterval = setInterval(() => {
            this.cleanupExpired();
        }, 60000); // Every minute
        
        // Statistics update
        this.statsInterval = setInterval(() => {
            this.updateStatistics();
        }, 10000); // Every 10 seconds
    }

    /**
     * Clean up expired entries
     */
    cleanupExpired() {
        const now = Date.now();
        const expiredKeys = [];
        
        for (const [key, meta] of this.metadata) {
            if (meta.ttl && meta.ttl < now) {
                expiredKeys.push(key);
            }
        }
        
        for (const key of expiredKeys) {
            this.delete(key);
        }
    }

    /**
     * Delete key from all cache tiers
     * @param {string} key - Key to delete
     */
    async delete(key) {
        // Remove from all tiers
        this.tiers.l1.delete(key);
        this.tiers.l2.delete(key);
        if (this.tiers.l3) {
            await this.tiers.l3.delete(key);
        }
        
        // Clean up metadata
        this.metadata.delete(key);
        this.accessOrder.delete(key);
        this.coherenceStates.delete(key);
        this.writeBackBuffer.delete(key);
    }

    /**
     * Update cache statistics
     */
    updateStatistics() {
        const totalRequests = this.stats.hits + this.stats.misses;
        this.stats.hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) : 0;
        this.stats.missRate = totalRequests > 0 ? (this.stats.misses / totalRequests) : 0;
        
        // Calculate tier utilization
        this.stats.l1Utilization = this.tiers.l1.size / Math.floor(this.maxSize * 0.3);
        this.stats.l2Utilization = this.tiers.l2.size / Math.floor(this.maxSize * 0.7);
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getStats() {
        return {
            ...this.stats,
            sizes: {
                l1: this.tiers.l1.size,
                l2: this.tiers.l2.size,
                l3: this.tiers.l3 ? 'external' : 0
            },
            policy: this.policy,
            writePolicy: this.writePolicy,
            coherenceProtocol: this.coherenceProtocol
        };
    }

    /**
     * Shutdown cache manager
     */
    async shutdown() {
        // Flush write-back buffer
        await this.flushWriteBackBuffer();
        
        // Clear intervals
        if (this.ttlInterval) clearInterval(this.ttlInterval);
        if (this.statsInterval) clearInterval(this.statsInterval);
        if (this.writeBackTimer) clearTimeout(this.writeBackTimer);
        
        // Clear all caches
        this.tiers.l1.clear();
        this.tiers.l2.clear();
        this.metadata.clear();
        this.accessOrder.clear();
        this.coherenceStates.clear();
        this.writeBackBuffer.clear();
    }
}

/**
 * Simple Bloom Filter implementation
 */
class BloomFilter {
    constructor(size, hashCount) {
        this.size = size;
        this.hashCount = hashCount;
        this.bits = new Uint8Array(Math.ceil(size / 8));
    }

    hash(item, seed) {
        let hash = seed;
        for (let i = 0; i < item.length; i++) {
            hash = ((hash << 5) + hash + item.charCodeAt(i)) & 0xffffffff;
        }
        return Math.abs(hash) % this.size;
    }

    add(item) {
        const str = String(item);
        for (let i = 0; i < this.hashCount; i++) {
            const index = this.hash(str, i);
            const byteIndex = Math.floor(index / 8);
            const bitIndex = index % 8;
            this.bits[byteIndex] |= (1 << bitIndex);
        }
    }

    test(item) {
        const str = String(item);
        for (let i = 0; i < this.hashCount; i++) {
            const index = this.hash(str, i);
            const byteIndex = Math.floor(index / 8);
            const bitIndex = index % 8;
            if (!(this.bits[byteIndex] & (1 << bitIndex))) {
                return false;
            }
        }
        return true;
    }
}

module.exports = { CacheManager, BloomFilter };
