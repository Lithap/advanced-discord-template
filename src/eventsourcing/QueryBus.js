/**
 * CQRS Query Bus Implementation
 * Handles query routing, caching, and execution with read model optimization
 * Features: Query caching, result pagination, query optimization, read replicas
 */
const { EventEmitter } = require('events');

class QueryBus extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            cacheEnabled: options.cacheEnabled !== false,
            cacheTTL: options.cacheTTL || 300000, // 5 minutes
            maxCacheSize: options.maxCacheSize || 10000,
            queryTimeout: options.queryTimeout || 30000,
            enablePagination: options.enablePagination !== false,
            defaultPageSize: options.defaultPageSize || 50,
            maxPageSize: options.maxPageSize || 1000,
            ...options
        };
        
        // Query handlers registry
        this.handlers = new Map(); // queryType -> handler
        
        // Query cache
        this.cache = new Map(); // cacheKey -> { result, timestamp, ttl }
        this.cacheStats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
        
        // Read model repositories
        this.repositories = new Map(); // repositoryName -> repository
        
        // Query middleware
        this.middleware = [];
        
        // Query execution tracking
        this.executingQueries = new Map(); // queryId -> execution context
        
        // Performance metrics
        this.metrics = {
            queriesExecuted: 0,
            queriesCached: 0,
            averageExecutionTime: 0,
            totalExecutionTime: 0,
            handlerCounts: new Map(),
            slowQueries: []
        };
        
        // Query optimization
        this.queryOptimizer = new QueryOptimizer();
        
        // Read replica management
        this.readReplicas = new Map(); // replicaId -> replica connection
        this.replicaSelector = new ReplicaSelector();
        
        this.initialize();
    }

    /**
     * Initialize query bus
     */
    initialize() {
        // Setup default middleware
        this.use(this.createCacheMiddleware());
        this.use(this.createPaginationMiddleware());
        this.use(this.createOptimizationMiddleware());
        
        // Start cache cleanup
        this.startCacheCleanup();
        
        this.emit('initialized');
    }

    /**
     * Register query handler
     * @param {string} queryType - Query type
     * @param {Function} handler - Query handler function
     * @param {Object} options - Handler options
     */
    registerHandler(queryType, handler, options = {}) {
        if (this.handlers.has(queryType)) {
            throw new Error(`Handler already registered for query type: ${queryType}`);
        }
        
        this.handlers.set(queryType, {
            handler,
            options: {
                cacheable: options.cacheable !== false,
                cacheTTL: options.cacheTTL || this.options.cacheTTL,
                timeout: options.timeout || this.options.queryTimeout,
                paginated: options.paginated || false,
                readReplica: options.readReplica || false,
                ...options
            }
        });
        
        // Initialize metrics for this handler
        this.metrics.handlerCounts.set(queryType, 0);
        
        this.emit('handler-registered', { queryType });
    }

    /**
     * Register read model repository
     * @param {string} name - Repository name
     * @param {Object} repository - Repository instance
     */
    registerRepository(name, repository) {
        this.repositories.set(name, repository);
        this.emit('repository-registered', { name });
    }

    /**
     * Register read replica
     * @param {string} replicaId - Replica identifier
     * @param {Object} replica - Replica connection
     * @param {Object} options - Replica options
     */
    registerReadReplica(replicaId, replica, options = {}) {
        this.readReplicas.set(replicaId, {
            connection: replica,
            weight: options.weight || 1,
            region: options.region || 'default',
            healthy: true,
            lastHealthCheck: Date.now()
        });
        
        this.emit('replica-registered', { replicaId });
    }

    /**
     * Add middleware to pipeline
     * @param {Function} middleware - Middleware function
     */
    use(middleware) {
        if (typeof middleware !== 'function') {
            throw new Error('Middleware must be a function');
        }
        
        this.middleware.push(middleware);
    }

    /**
     * Execute query through the bus
     * @param {Object} query - Query to execute
     * @param {Object} context - Execution context
     * @returns {Promise<*>} Query result
     */
    async execute(query, context = {}) {
        const queryId = this.generateQueryId();
        const startTime = process.hrtime.bigint();
        
        // Create execution context
        const executionContext = {
            queryId,
            query,
            context,
            startTime,
            metadata: {
                userId: context.userId,
                correlationId: context.correlationId || queryId,
                timestamp: Date.now()
            }
        };
        
        this.executingQueries.set(queryId, executionContext);
        
        try {
            // Execute through middleware pipeline
            const result = await this.executeWithMiddleware(executionContext);
            
            // Update metrics
            this.updateSuccessMetrics(query.type, startTime);
            
            // Check for slow queries
            const executionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
            if (executionTime > 1000) { // Slow query threshold: 1 second
                this.recordSlowQuery(query, executionTime);
            }
            
            // Emit success event
            this.emit('query-executed', {
                queryId,
                queryType: query.type,
                executionTime,
                cached: result._cached || false
            });
            
            return result;
            
        } catch (error) {
            // Update error metrics
            this.updateErrorMetrics(query.type, error);
            
            // Emit error event
            this.emit('query-failed', {
                queryId,
                queryType: query.type,
                error: error.message
            });
            
            throw error;
            
        } finally {
            this.executingQueries.delete(queryId);
        }
    }

    /**
     * Execute query through middleware pipeline
     * @param {Object} executionContext - Execution context
     * @returns {Promise<*>} Query result
     */
    async executeWithMiddleware(executionContext) {
        let index = 0;
        
        const next = async () => {
            if (index >= this.middleware.length) {
                // Execute the actual query handler
                return await this.executeHandler(executionContext);
            }
            
            const middleware = this.middleware[index++];
            return await middleware(executionContext, next);
        };
        
        return await next();
    }

    /**
     * Execute query handler
     * @param {Object} executionContext - Execution context
     * @returns {Promise<*>} Query result
     */
    async executeHandler(executionContext) {
        const { query } = executionContext;
        const handlerConfig = this.handlers.get(query.type);
        
        if (!handlerConfig) {
            throw new QueryHandlerNotFoundError(`No handler registered for query type: ${query.type}`);
        }
        
        const { handler, options } = handlerConfig;
        
        // Select read replica if configured
        let repository = this.repositories.get(query.repository);
        if (options.readReplica && this.readReplicas.size > 0) {
            const replica = this.replicaSelector.selectReplica(this.readReplicas, query);
            repository = replica?.connection || repository;
        }
        
        // Execute with timeout
        return await this.executeWithTimeout(
            () => handler(query, { ...executionContext.context, repository }),
            options.timeout
        );
    }

    /**
     * Execute function with timeout
     * @param {Function} fn - Function to execute
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<*>} Function result
     */
    async executeWithTimeout(fn, timeout) {
        return new Promise(async (resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                reject(new QueryTimeoutError(`Query execution timed out after ${timeout}ms`));
            }, timeout);
            
            try {
                const result = await fn();
                clearTimeout(timeoutHandle);
                resolve(result);
            } catch (error) {
                clearTimeout(timeoutHandle);
                reject(error);
            }
        });
    }

    /**
     * Create cache middleware
     * @returns {Function} Cache middleware
     */
    createCacheMiddleware() {
        return async (executionContext, next) => {
            if (!this.options.cacheEnabled) {
                return await next();
            }
            
            const { query } = executionContext;
            const handlerConfig = this.handlers.get(query.type);
            
            if (!handlerConfig?.options.cacheable) {
                return await next();
            }
            
            // Generate cache key
            const cacheKey = this.generateCacheKey(query);
            
            // Check cache
            const cached = this.cache.get(cacheKey);
            if (cached && this.isCacheValid(cached)) {
                this.cacheStats.hits++;
                this.metrics.queriesCached++;
                
                return {
                    ...cached.result,
                    _cached: true,
                    _cacheTimestamp: cached.timestamp
                };
            }
            
            this.cacheStats.misses++;
            
            // Execute query
            const result = await next();
            
            // Cache result
            this.cacheResult(cacheKey, result, handlerConfig.options.cacheTTL);
            
            return result;
        };
    }

    /**
     * Create pagination middleware
     * @returns {Function} Pagination middleware
     */
    createPaginationMiddleware() {
        return async (executionContext, next) => {
            if (!this.options.enablePagination) {
                return await next();
            }
            
            const { query } = executionContext;
            const handlerConfig = this.handlers.get(query.type);
            
            if (!handlerConfig?.options.paginated) {
                return await next();
            }
            
            // Apply pagination parameters
            query.page = Math.max(1, query.page || 1);
            query.pageSize = Math.min(
                query.pageSize || this.options.defaultPageSize,
                this.options.maxPageSize
            );
            query.offset = (query.page - 1) * query.pageSize;
            
            const result = await next();
            
            // Add pagination metadata
            if (result && typeof result === 'object') {
                result._pagination = {
                    page: query.page,
                    pageSize: query.pageSize,
                    totalCount: result.totalCount || result.data?.length || 0,
                    totalPages: Math.ceil((result.totalCount || 0) / query.pageSize),
                    hasNext: query.page * query.pageSize < (result.totalCount || 0),
                    hasPrevious: query.page > 1
                };
            }
            
            return result;
        };
    }

    /**
     * Create optimization middleware
     * @returns {Function} Optimization middleware
     */
    createOptimizationMiddleware() {
        return async (executionContext, next) => {
            const { query } = executionContext;
            
            // Apply query optimizations
            const optimizedQuery = this.queryOptimizer.optimize(query);
            executionContext.query = optimizedQuery;
            
            return await next();
        };
    }

    /**
     * Generate cache key for query
     * @param {Object} query - Query object
     * @returns {string} Cache key
     */
    generateCacheKey(query) {
        const crypto = require('crypto');
        const queryString = JSON.stringify(query, Object.keys(query).sort());
        return crypto.createHash('sha256').update(queryString).digest('hex');
    }

    /**
     * Check if cached result is still valid
     * @param {Object} cached - Cached result
     * @returns {boolean} Is valid
     */
    isCacheValid(cached) {
        return Date.now() - cached.timestamp < cached.ttl;
    }

    /**
     * Cache query result
     * @param {string} cacheKey - Cache key
     * @param {*} result - Query result
     * @param {number} ttl - Time to live
     */
    cacheResult(cacheKey, result, ttl) {
        // Check cache size limit
        if (this.cache.size >= this.options.maxCacheSize) {
            this.evictOldestCacheEntry();
        }
        
        this.cache.set(cacheKey, {
            result: JSON.parse(JSON.stringify(result)), // Deep clone
            timestamp: Date.now(),
            ttl
        });
    }

    /**
     * Evict oldest cache entry
     */
    evictOldestCacheEntry() {
        let oldestKey = null;
        let oldestTimestamp = Infinity;
        
        for (const [key, cached] of this.cache) {
            if (cached.timestamp < oldestTimestamp) {
                oldestTimestamp = cached.timestamp;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.cacheStats.evictions++;
        }
    }

    /**
     * Start cache cleanup process
     */
    startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            const expiredKeys = [];
            
            for (const [key, cached] of this.cache) {
                if (now - cached.timestamp >= cached.ttl) {
                    expiredKeys.push(key);
                }
            }
            
            for (const key of expiredKeys) {
                this.cache.delete(key);
                this.cacheStats.evictions++;
            }
        }, 60000); // Every minute
    }

    /**
     * Record slow query
     * @param {Object} query - Slow query
     * @param {number} executionTime - Execution time in ms
     */
    recordSlowQuery(query, executionTime) {
        this.metrics.slowQueries.push({
            query: { ...query },
            executionTime,
            timestamp: Date.now()
        });
        
        // Keep only last 100 slow queries
        if (this.metrics.slowQueries.length > 100) {
            this.metrics.slowQueries.shift();
        }
        
        this.emit('slow-query', { query, executionTime });
    }

    /**
     * Update success metrics
     * @param {string} queryType - Query type
     * @param {bigint} startTime - Start time
     */
    updateSuccessMetrics(queryType, startTime) {
        this.metrics.queriesExecuted++;
        
        const executionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
        this.metrics.totalExecutionTime += executionTime;
        this.metrics.averageExecutionTime = this.metrics.totalExecutionTime / this.metrics.queriesExecuted;
        
        const handlerCount = this.metrics.handlerCounts.get(queryType) || 0;
        this.metrics.handlerCounts.set(queryType, handlerCount + 1);
    }

    /**
     * Update error metrics
     * @param {string} queryType - Query type
     * @param {Error} error - Error that occurred
     */
    updateErrorMetrics(queryType, error) {
        // Track error metrics if needed
    }

    /**
     * Generate unique query ID
     * @returns {string} Query ID
     */
    generateQueryId() {
        const crypto = require('crypto');
        return `qry_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Invalidate cache entries
     * @param {string|RegExp} pattern - Cache key pattern
     */
    invalidateCache(pattern) {
        const keysToDelete = [];
        
        for (const key of this.cache.keys()) {
            if (typeof pattern === 'string' && key.includes(pattern)) {
                keysToDelete.push(key);
            } else if (pattern instanceof RegExp && pattern.test(key)) {
                keysToDelete.push(key);
            }
        }
        
        for (const key of keysToDelete) {
            this.cache.delete(key);
        }
        
        this.emit('cache-invalidated', { pattern, keysDeleted: keysToDelete.length });
    }

    /**
     * Get query bus metrics
     * @returns {Object} Metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            handlerCounts: Object.fromEntries(this.metrics.handlerCounts),
            registeredHandlers: this.handlers.size,
            registeredRepositories: this.repositories.size,
            registeredReplicas: this.readReplicas.size,
            middlewareCount: this.middleware.length,
            executingQueries: this.executingQueries.size,
            cacheStats: {
                ...this.cacheStats,
                size: this.cache.size,
                hitRate: this.cacheStats.hits + this.cacheStats.misses > 0
                    ? ((this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100).toFixed(2) + '%'
                    : '0%'
            }
        };
    }

    /**
     * Get executing queries
     * @returns {Array} Currently executing queries
     */
    getExecutingQueries() {
        return Array.from(this.executingQueries.values()).map(context => ({
            queryId: context.queryId,
            queryType: context.query.type,
            startTime: context.startTime,
            duration: Number(process.hrtime.bigint() - context.startTime) / 1000000
        }));
    }

    /**
     * Get slow queries
     * @returns {Array} Slow queries
     */
    getSlowQueries() {
        return [...this.metrics.slowQueries];
    }

    /**
     * Shutdown query bus
     */
    async shutdown() {
        // Wait for executing queries to complete
        const maxWaitTime = 30000; // 30 seconds
        const startTime = Date.now();
        
        while (this.executingQueries.size > 0 && (Date.now() - startTime) < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Clear cache
        this.cache.clear();
        
        this.emit('shutdown');
    }
}

/**
 * Query optimizer for performance improvements
 */
class QueryOptimizer {
    optimize(query) {
        // Apply various optimizations
        let optimized = { ...query };
        
        // Add indexes hints if available
        optimized = this.addIndexHints(optimized);
        
        // Optimize filters
        optimized = this.optimizeFilters(optimized);
        
        // Optimize sorting
        optimized = this.optimizeSorting(optimized);
        
        return optimized;
    }

    addIndexHints(query) {
        // Add database index hints based on query patterns
        return query;
    }

    optimizeFilters(query) {
        // Reorder filters for optimal execution
        if (query.filters && Array.isArray(query.filters)) {
            // Sort filters by selectivity (most selective first)
            query.filters.sort((a, b) => {
                const selectivityA = this.estimateSelectivity(a);
                const selectivityB = this.estimateSelectivity(b);
                return selectivityA - selectivityB;
            });
        }
        
        return query;
    }

    optimizeSorting(query) {
        // Optimize sorting operations
        return query;
    }

    estimateSelectivity(filter) {
        // Estimate filter selectivity (lower is more selective)
        switch (filter.operator) {
            case '=': return 0.1;
            case 'in': return 0.3;
            case 'like': return 0.5;
            case '>': case '<': return 0.4;
            default: return 0.8;
        }
    }
}

/**
 * Read replica selector for load balancing
 */
class ReplicaSelector {
    selectReplica(replicas, query) {
        const healthyReplicas = Array.from(replicas.values())
            .filter(replica => replica.healthy);
        
        if (healthyReplicas.length === 0) {
            return null;
        }
        
        // Weighted random selection
        const totalWeight = healthyReplicas.reduce((sum, replica) => sum + replica.weight, 0);
        let random = Math.random() * totalWeight;
        
        for (const replica of healthyReplicas) {
            random -= replica.weight;
            if (random <= 0) {
                return replica;
            }
        }
        
        return healthyReplicas[0]; // Fallback
    }
}

// Custom error classes
class QueryHandlerNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'QueryHandlerNotFoundError';
    }
}

class QueryTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'QueryTimeoutError';
    }
}

module.exports = {
    QueryBus,
    QueryOptimizer,
    ReplicaSelector,
    QueryHandlerNotFoundError,
    QueryTimeoutError
};
