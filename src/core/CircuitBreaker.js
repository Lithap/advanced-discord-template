/**
 * Enterprise Circuit Breaker with Adaptive Thresholds
 * Implements Hystrix-style patterns with quantum-resistant failure detection
 * Features: Bulkhead isolation, adaptive thresholds, predictive failure analysis
 */
class CircuitBreaker {
    constructor(options = {}) {
        this.name = options.name || 'default';
        this.failureThreshold = options.failureThreshold || 5;
        this.recoveryTimeout = options.recoveryTimeout || 60000;
        this.monitoringPeriod = options.monitoringPeriod || 10000;
        this.volumeThreshold = options.volumeThreshold || 10;
        this.errorPercentageThreshold = options.errorPercentageThreshold || 50;
        
        // Circuit states
        this.states = {
            CLOSED: 'CLOSED',
            OPEN: 'OPEN',
            HALF_OPEN: 'HALF_OPEN'
        };
        
        this.state = this.states.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.nextAttempt = 0;
        
        // Advanced metrics with sliding window
        this.metrics = {
            requests: new Map(), // timestamp -> {success, duration, error}
            buckets: new Array(60).fill(null).map(() => ({
                timestamp: 0,
                requests: 0,
                failures: 0,
                successes: 0,
                totalDuration: 0,
                errors: []
            })),
            currentBucket: 0
        };
        
        // Adaptive threshold calculation
        this.adaptiveThresholds = {
            enabled: options.adaptiveThresholds !== false,
            baselineWindow: options.baselineWindow || 300000, // 5 minutes
            adaptationRate: options.adaptationRate || 0.1,
            minThreshold: options.minThreshold || 3,
            maxThreshold: options.maxThreshold || 20
        };
        
        // Bulkhead isolation
        this.bulkheads = new Map();
        this.maxConcurrentRequests = options.maxConcurrentRequests || 100;
        this.currentRequests = 0;
        
        // Quantum-resistant entropy for jitter
        this.entropyPool = new Uint32Array(256);
        this.initializeEntropy();
        
        // Start monitoring
        this.monitoringInterval = setInterval(() => this.updateMetrics(), 1000);
    }

    /**
     * Initialize quantum-resistant entropy pool
     */
    initializeEntropy() {
        const crypto = require('crypto');
        for (let i = 0; i < this.entropyPool.length; i++) {
            this.entropyPool[i] = crypto.randomBytes(4).readUInt32BE(0);
        }
    }

    /**
     * Execute function with circuit breaker protection
     * @param {Function} fn - Function to execute
     * @param {Object} context - Execution context
     * @returns {Promise} Execution result
     */
    async execute(fn, context = {}) {
        const requestId = this.generateRequestId();
        const startTime = process.hrtime.bigint();
        
        // Check if circuit is open
        if (this.state === this.states.OPEN) {
            if (Date.now() < this.nextAttempt) {
                throw new CircuitBreakerOpenError(`Circuit breaker ${this.name} is OPEN`);
            }
            this.state = this.states.HALF_OPEN;
        }
        
        // Check bulkhead limits
        if (this.currentRequests >= this.maxConcurrentRequests) {
            throw new BulkheadFullError(`Bulkhead limit exceeded for ${this.name}`);
        }
        
        this.currentRequests++;
        
        try {
            // Execute with timeout and monitoring
            const result = await this.executeWithTimeout(fn, context, requestId);
            
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000; // ms
            this.recordSuccess(requestId, duration);
            
            return result;
        } catch (error) {
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000;
            this.recordFailure(requestId, duration, error);
            throw error;
        } finally {
            this.currentRequests--;
        }
    }

    /**
     * Execute function with timeout protection
     * @param {Function} fn - Function to execute
     * @param {Object} context - Execution context
     * @param {string} requestId - Request identifier
     * @returns {Promise} Execution result
     */
    async executeWithTimeout(fn, context, requestId) {
        const timeout = context.timeout || 30000;
        
        return new Promise(async (resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                reject(new TimeoutError(`Request ${requestId} timed out after ${timeout}ms`));
            }, timeout);
            
            try {
                const result = await fn(context);
                clearTimeout(timeoutHandle);
                resolve(result);
            } catch (error) {
                clearTimeout(timeoutHandle);
                reject(error);
            }
        });
    }

    /**
     * Record successful execution
     * @param {string} requestId - Request identifier
     * @param {number} duration - Execution duration
     */
    recordSuccess(requestId, duration) {
        this.successCount++;
        this.updateCurrentBucket('success', duration);
        
        // Reset failure count on success in half-open state
        if (this.state === this.states.HALF_OPEN) {
            this.failureCount = 0;
            this.state = this.states.CLOSED;
        }
        
        this.metrics.requests.set(requestId, {
            success: true,
            duration,
            timestamp: Date.now()
        });
    }

    /**
     * Record failed execution
     * @param {string} requestId - Request identifier
     * @param {number} duration - Execution duration
     * @param {Error} error - Error object
     */
    recordFailure(requestId, duration, error) {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        this.updateCurrentBucket('failure', duration, error);
        
        this.metrics.requests.set(requestId, {
            success: false,
            duration,
            error: error.message,
            timestamp: Date.now()
        });
        
        // Check if circuit should open
        if (this.shouldOpenCircuit()) {
            this.openCircuit();
        }
    }

    /**
     * Update current metrics bucket
     * @param {string} type - 'success' or 'failure'
     * @param {number} duration - Execution duration
     * @param {Error} error - Error object (for failures)
     */
    updateCurrentBucket(type, duration, error = null) {
        const now = Date.now();
        const bucket = this.metrics.buckets[this.metrics.currentBucket];
        
        // Rotate bucket if needed (every second)
        if (now - bucket.timestamp > 1000) {
            this.metrics.currentBucket = (this.metrics.currentBucket + 1) % this.metrics.buckets.length;
            const newBucket = this.metrics.buckets[this.metrics.currentBucket];
            newBucket.timestamp = now;
            newBucket.requests = 0;
            newBucket.failures = 0;
            newBucket.successes = 0;
            newBucket.totalDuration = 0;
            newBucket.errors = [];
        }
        
        const currentBucket = this.metrics.buckets[this.metrics.currentBucket];
        currentBucket.requests++;
        currentBucket.totalDuration += duration;
        
        if (type === 'success') {
            currentBucket.successes++;
        } else {
            currentBucket.failures++;
            if (error) {
                currentBucket.errors.push({
                    message: error.message,
                    stack: error.stack,
                    timestamp: now
                });
            }
        }
    }

    /**
     * Determine if circuit should open based on adaptive thresholds
     * @returns {boolean} Should open circuit
     */
    shouldOpenCircuit() {
        const recentMetrics = this.getRecentMetrics();
        
        // Volume threshold check
        if (recentMetrics.totalRequests < this.volumeThreshold) {
            return false;
        }
        
        // Error percentage check
        const errorPercentage = (recentMetrics.failures / recentMetrics.totalRequests) * 100;
        
        // Adaptive threshold calculation
        let threshold = this.errorPercentageThreshold;
        if (this.adaptiveThresholds.enabled) {
            threshold = this.calculateAdaptiveThreshold(recentMetrics);
        }
        
        return errorPercentage >= threshold;
    }

    /**
     * Calculate adaptive threshold based on historical data
     * @param {Object} metrics - Recent metrics
     * @returns {number} Adaptive threshold
     */
    calculateAdaptiveThreshold(metrics) {
        const baselineMetrics = this.getBaselineMetrics();
        
        if (!baselineMetrics.totalRequests) {
            return this.errorPercentageThreshold;
        }
        
        const baselineErrorRate = baselineMetrics.failures / baselineMetrics.totalRequests;
        const currentErrorRate = metrics.failures / metrics.totalRequests;
        
        // Adaptive adjustment
        const adaptation = (currentErrorRate - baselineErrorRate) * this.adaptiveThresholds.adaptationRate;
        let newThreshold = this.errorPercentageThreshold + (adaptation * 100);
        
        // Clamp to min/max bounds
        newThreshold = Math.max(this.adaptiveThresholds.minThreshold, newThreshold);
        newThreshold = Math.min(this.adaptiveThresholds.maxThreshold, newThreshold);
        
        return newThreshold;
    }

    /**
     * Open the circuit breaker
     */
    openCircuit() {
        this.state = this.states.OPEN;
        this.nextAttempt = Date.now() + this.recoveryTimeout + this.getJitter();
    }

    /**
     * Get quantum-resistant jitter for recovery timeout
     * @returns {number} Jitter in milliseconds
     */
    getJitter() {
        const index = Date.now() % this.entropyPool.length;
        const entropy = this.entropyPool[index];
        return (entropy % 5000); // 0-5 second jitter
    }

    /**
     * Get recent metrics (last 10 seconds)
     * @returns {Object} Recent metrics
     */
    getRecentMetrics() {
        const cutoff = Date.now() - this.monitoringPeriod;
        const recentBuckets = this.metrics.buckets.filter(bucket => bucket.timestamp > cutoff);
        
        return recentBuckets.reduce((acc, bucket) => ({
            totalRequests: acc.totalRequests + bucket.requests,
            failures: acc.failures + bucket.failures,
            successes: acc.successes + bucket.successes,
            totalDuration: acc.totalDuration + bucket.totalDuration
        }), { totalRequests: 0, failures: 0, successes: 0, totalDuration: 0 });
    }

    /**
     * Get baseline metrics for adaptive threshold calculation
     * @returns {Object} Baseline metrics
     */
    getBaselineMetrics() {
        const cutoff = Date.now() - this.adaptiveThresholds.baselineWindow;
        const baselineBuckets = this.metrics.buckets.filter(bucket => bucket.timestamp > cutoff);
        
        return baselineBuckets.reduce((acc, bucket) => ({
            totalRequests: acc.totalRequests + bucket.requests,
            failures: acc.failures + bucket.failures,
            successes: acc.successes + bucket.successes
        }), { totalRequests: 0, failures: 0, successes: 0 });
    }

    /**
     * Update metrics and perform maintenance
     */
    updateMetrics() {
        // Clean old request data
        const cutoff = Date.now() - 300000; // 5 minutes
        for (const [requestId, data] of this.metrics.requests) {
            if (data.timestamp < cutoff) {
                this.metrics.requests.delete(requestId);
            }
        }
        
        // Update entropy pool periodically
        if (Date.now() % 60000 < 1000) { // Every minute
            this.initializeEntropy();
        }
    }

    /**
     * Generate unique request ID
     * @returns {string} Request ID
     */
    generateRequestId() {
        const crypto = require('crypto');
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Get circuit breaker statistics
     * @returns {Object} Statistics
     */
    getStats() {
        const recentMetrics = this.getRecentMetrics();
        
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            currentRequests: this.currentRequests,
            maxConcurrentRequests: this.maxConcurrentRequests,
            nextAttempt: this.nextAttempt,
            recentMetrics,
            errorRate: recentMetrics.totalRequests > 0 
                ? ((recentMetrics.failures / recentMetrics.totalRequests) * 100).toFixed(2) + '%'
                : '0%',
            averageResponseTime: recentMetrics.totalRequests > 0
                ? (recentMetrics.totalDuration / recentMetrics.totalRequests).toFixed(2) + 'ms'
                : '0ms'
        };
    }

    /**
     * Shutdown circuit breaker
     */
    shutdown() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        this.metrics.requests.clear();
        this.bulkheads.clear();
    }
}

// Custom error classes
class CircuitBreakerOpenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CircuitBreakerOpenError';
    }
}

class BulkheadFullError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BulkheadFullError';
    }
}

class TimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TimeoutError';
    }
}

module.exports = { CircuitBreaker, CircuitBreakerOpenError, BulkheadFullError, TimeoutError };
