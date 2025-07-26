/**
 * Performance Benchmarking Suite
 * Comprehensive performance testing with statistical analysis and regression detection
 * Features: Load testing, stress testing, endurance testing, memory profiling
 */
const { EventEmitter } = require('events');

class PerformanceBenchmark extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            warmupIterations: options.warmupIterations || 10,
            benchmarkIterations: options.benchmarkIterations || 100,
            maxDuration: options.maxDuration || 300000, // 5 minutes
            memoryProfiling: options.memoryProfiling !== false,
            cpuProfiling: options.cpuProfiling !== false,
            statisticalAnalysis: options.statisticalAnalysis !== false,
            regressionDetection: options.regressionDetection !== false,
            ...options
        };
        
        // Benchmark registry
        this.benchmarks = new Map(); // benchmarkName -> benchmark definition
        
        // Test suites
        this.suites = new Map(); // suiteName -> suite definition
        
        // Results storage
        this.results = new Map(); // benchmarkName -> results array
        this.historicalResults = new Map(); // benchmarkName -> historical data
        
        // Performance profiles
        this.profiles = new Map(); // profileName -> profile data
        
        // Load testing configurations
        this.loadTests = new Map(); // testName -> load test config
        
        // Statistical analyzers
        this.analyzers = {
            descriptive: new DescriptiveStatistics(),
            regression: new RegressionAnalyzer(),
            outlier: new OutlierDetector(),
            trend: new TrendAnalyzer()
        };
        
        // Performance metrics
        this.metrics = {
            benchmarksRun: 0,
            totalExecutionTime: 0,
            averageExecutionTime: 0,
            memoryLeaksDetected: 0,
            performanceRegressions: 0
        };
        
        this.initialize();
    }

    /**
     * Initialize benchmark suite
     */
    initialize() {
        // Setup memory monitoring
        if (this.options.memoryProfiling) {
            this.startMemoryMonitoring();
        }
        
        // Setup CPU profiling
        if (this.options.cpuProfiling) {
            this.setupCpuProfiling();
        }
        
        this.emit('initialized');
    }

    /**
     * Register benchmark
     * @param {string} name - Benchmark name
     * @param {Function} fn - Benchmark function
     * @param {Object} options - Benchmark options
     */
    benchmark(name, fn, options = {}) {
        this.benchmarks.set(name, {
            name,
            fn,
            options: {
                iterations: options.iterations || this.options.benchmarkIterations,
                warmup: options.warmup || this.options.warmupIterations,
                timeout: options.timeout || 30000,
                async: options.async !== false,
                setup: options.setup,
                teardown: options.teardown,
                ...options
            }
        });
        
        return this;
    }

    /**
     * Create benchmark suite
     * @param {string} name - Suite name
     * @param {Function} definition - Suite definition function
     */
    suite(name, definition) {
        const suite = {
            name,
            benchmarks: new Map(),
            setup: null,
            teardown: null
        };
        
        // Create suite context
        const context = {
            benchmark: (benchName, fn, options) => {
                suite.benchmarks.set(benchName, { fn, options });
            },
            setup: (fn) => { suite.setup = fn; },
            teardown: (fn) => { suite.teardown = fn; }
        };
        
        definition(context);
        this.suites.set(name, suite);
        
        return this;
    }

    /**
     * Run single benchmark
     * @param {string} name - Benchmark name
     * @returns {Promise<Object>} Benchmark results
     */
    async runBenchmark(name) {
        const benchmark = this.benchmarks.get(name);
        if (!benchmark) {
            throw new Error(`Benchmark not found: ${name}`);
        }
        
        const startTime = Date.now();
        const results = {
            name,
            iterations: benchmark.options.iterations,
            warmupIterations: benchmark.options.warmup,
            measurements: [],
            statistics: {},
            memoryProfile: null,
            cpuProfile: null,
            startTime,
            endTime: null
        };
        
        try {
            // Setup
            if (benchmark.options.setup) {
                await benchmark.options.setup();
            }
            
            // Warmup phase
            await this.runWarmup(benchmark);
            
            // Start profiling
            const memoryProfiler = this.options.memoryProfiling ? 
                this.startMemoryProfiling(name) : null;
            const cpuProfiler = this.options.cpuProfiling ? 
                this.startCpuProfiling(name) : null;
            
            // Benchmark phase
            for (let i = 0; i < benchmark.options.iterations; i++) {
                const measurement = await this.runSingleIteration(benchmark);
                results.measurements.push(measurement);
                
                // Check for timeout
                if (Date.now() - startTime > this.options.maxDuration) {
                    break;
                }
            }
            
            // Stop profiling
            if (memoryProfiler) {
                results.memoryProfile = await this.stopMemoryProfiling(memoryProfiler);
            }
            if (cpuProfiler) {
                results.cpuProfile = await this.stopCpuProfiling(cpuProfiler);
            }
            
            // Statistical analysis
            if (this.options.statisticalAnalysis) {
                results.statistics = this.analyzers.descriptive.analyze(
                    results.measurements.map(m => m.duration)
                );
                
                // Outlier detection
                results.outliers = this.analyzers.outlier.detect(
                    results.measurements.map(m => m.duration)
                );
            }
            
            // Regression detection
            if (this.options.regressionDetection) {
                const regression = await this.detectRegression(name, results);
                results.regression = regression;
            }
            
            // Teardown
            if (benchmark.options.teardown) {
                await benchmark.options.teardown();
            }
            
            results.endTime = Date.now();
            results.totalDuration = results.endTime - startTime;
            
            // Store results
            if (!this.results.has(name)) {
                this.results.set(name, []);
            }
            this.results.get(name).push(results);
            
            // Update metrics
            this.metrics.benchmarksRun++;
            this.metrics.totalExecutionTime += results.totalDuration;
            this.metrics.averageExecutionTime = 
                this.metrics.totalExecutionTime / this.metrics.benchmarksRun;
            
            this.emit('benchmark-completed', { name, results });
            
            return results;
            
        } catch (error) {
            results.error = error.message;
            results.endTime = Date.now();
            
            this.emit('benchmark-failed', { name, error });
            throw error;
        }
    }

    /**
     * Run warmup iterations
     * @param {Object} benchmark - Benchmark definition
     */
    async runWarmup(benchmark) {
        for (let i = 0; i < benchmark.options.warmup; i++) {
            await this.runSingleIteration(benchmark);
        }
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
    }

    /**
     * Run single benchmark iteration
     * @param {Object} benchmark - Benchmark definition
     * @returns {Promise<Object>} Measurement
     */
    async runSingleIteration(benchmark) {
        const startTime = process.hrtime.bigint();
        const startMemory = process.memoryUsage();
        
        try {
            let result;
            
            if (benchmark.options.async) {
                result = await this.executeWithTimeout(
                    benchmark.fn,
                    benchmark.options.timeout
                );
            } else {
                result = benchmark.fn();
            }
            
            const endTime = process.hrtime.bigint();
            const endMemory = process.memoryUsage();
            
            return {
                duration: Number(endTime - startTime) / 1000000, // Convert to milliseconds
                memoryDelta: {
                    heapUsed: endMemory.heapUsed - startMemory.heapUsed,
                    heapTotal: endMemory.heapTotal - startMemory.heapTotal,
                    external: endMemory.external - startMemory.external
                },
                result,
                timestamp: Date.now()
            };
            
        } catch (error) {
            const endTime = process.hrtime.bigint();
            
            return {
                duration: Number(endTime - startTime) / 1000000,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Run benchmark suite
     * @param {string} suiteName - Suite name
     * @returns {Promise<Object>} Suite results
     */
    async runSuite(suiteName) {
        const suite = this.suites.get(suiteName);
        if (!suite) {
            throw new Error(`Suite not found: ${suiteName}`);
        }
        
        const startTime = Date.now();
        const results = {
            suite: suiteName,
            benchmarks: new Map(),
            startTime,
            endTime: null
        };
        
        try {
            // Suite setup
            if (suite.setup) {
                await suite.setup();
            }
            
            // Run benchmarks
            for (const [benchName, benchDef] of suite.benchmarks) {
                // Register temporary benchmark
                const fullName = `${suiteName}.${benchName}`;
                this.benchmark(fullName, benchDef.fn, benchDef.options);
                
                // Run benchmark
                const benchResult = await this.runBenchmark(fullName);
                results.benchmarks.set(benchName, benchResult);
                
                // Clean up temporary benchmark
                this.benchmarks.delete(fullName);
            }
            
            // Suite teardown
            if (suite.teardown) {
                await suite.teardown();
            }
            
            results.endTime = Date.now();
            results.totalDuration = results.endTime - startTime;
            
            this.emit('suite-completed', { suiteName, results });
            
            return results;
            
        } catch (error) {
            results.error = error.message;
            results.endTime = Date.now();
            
            this.emit('suite-failed', { suiteName, error });
            throw error;
        }
    }

    /**
     * Run load test
     * @param {string} name - Load test name
     * @param {Object} config - Load test configuration
     * @returns {Promise<Object>} Load test results
     */
    async runLoadTest(name, config) {
        const {
            target,
            concurrency = 10,
            duration = 60000,
            rampUp = 10000,
            rampDown = 10000
        } = config;
        
        const startTime = Date.now();
        const results = {
            name,
            config,
            startTime,
            endTime: null,
            phases: [],
            metrics: {
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                averageResponseTime: 0,
                throughput: 0,
                errorRate: 0
            }
        };
        
        try {
            // Ramp-up phase
            if (rampUp > 0) {
                const rampUpResults = await this.runLoadPhase('ramp-up', {
                    target,
                    startConcurrency: 1,
                    endConcurrency: concurrency,
                    duration: rampUp
                });
                results.phases.push(rampUpResults);
            }
            
            // Steady state phase
            const steadyResults = await this.runLoadPhase('steady', {
                target,
                startConcurrency: concurrency,
                endConcurrency: concurrency,
                duration
            });
            results.phases.push(steadyResults);
            
            // Ramp-down phase
            if (rampDown > 0) {
                const rampDownResults = await this.runLoadPhase('ramp-down', {
                    target,
                    startConcurrency: concurrency,
                    endConcurrency: 1,
                    duration: rampDown
                });
                results.phases.push(rampDownResults);
            }
            
            // Aggregate metrics
            results.metrics = this.aggregateLoadTestMetrics(results.phases);
            results.endTime = Date.now();
            results.totalDuration = results.endTime - startTime;
            
            this.emit('load-test-completed', { name, results });
            
            return results;
            
        } catch (error) {
            results.error = error.message;
            results.endTime = Date.now();
            
            this.emit('load-test-failed', { name, error });
            throw error;
        }
    }

    /**
     * Run load test phase
     * @param {string} phase - Phase name
     * @param {Object} config - Phase configuration
     * @returns {Promise<Object>} Phase results
     */
    async runLoadPhase(phase, config) {
        const { target, startConcurrency, endConcurrency, duration } = config;
        const startTime = Date.now();
        
        const results = {
            phase,
            startTime,
            endTime: null,
            requests: [],
            concurrencyLevels: []
        };
        
        const workers = new Map(); // workerId -> worker info
        let currentConcurrency = startConcurrency;
        
        // Calculate concurrency change rate
        const concurrencyDelta = (endConcurrency - startConcurrency) / (duration / 1000);
        
        const phaseInterval = setInterval(() => {
            // Adjust concurrency
            const targetConcurrency = Math.round(
                startConcurrency + concurrencyDelta * ((Date.now() - startTime) / 1000)
            );
            
            if (targetConcurrency > currentConcurrency) {
                // Add workers
                for (let i = currentConcurrency; i < targetConcurrency; i++) {
                    this.startLoadWorker(i, target, workers, results);
                }
            } else if (targetConcurrency < currentConcurrency) {
                // Remove workers
                for (let i = currentConcurrency - 1; i >= targetConcurrency; i--) {
                    this.stopLoadWorker(i, workers);
                }
            }
            
            currentConcurrency = targetConcurrency;
            results.concurrencyLevels.push({
                timestamp: Date.now(),
                concurrency: currentConcurrency
            });
            
        }, 1000); // Adjust every second
        
        // Wait for phase duration
        await this.sleep(duration);
        
        // Stop all workers
        clearInterval(phaseInterval);
        for (const workerId of workers.keys()) {
            this.stopLoadWorker(workerId, workers);
        }
        
        results.endTime = Date.now();
        
        return results;
    }

    /**
     * Start load test worker
     * @param {number} workerId - Worker ID
     * @param {Object} target - Target configuration
     * @param {Map} workers - Workers map
     * @param {Object} results - Results object
     */
    startLoadWorker(workerId, target, workers, results) {
        const worker = {
            id: workerId,
            active: true,
            requests: 0
        };
        
        workers.set(workerId, worker);
        
        // Start worker loop
        const workerLoop = async () => {
            while (worker.active) {
                const requestStart = Date.now();
                
                try {
                    await this.executeLoadRequest(target);
                    
                    const requestEnd = Date.now();
                    results.requests.push({
                        workerId,
                        startTime: requestStart,
                        endTime: requestEnd,
                        duration: requestEnd - requestStart,
                        success: true
                    });
                    
                    worker.requests++;
                    
                } catch (error) {
                    const requestEnd = Date.now();
                    results.requests.push({
                        workerId,
                        startTime: requestStart,
                        endTime: requestEnd,
                        duration: requestEnd - requestStart,
                        success: false,
                        error: error.message
                    });
                }
                
                // Small delay to prevent overwhelming
                await this.sleep(10);
            }
        };
        
        workerLoop().catch(error => {
            console.error(`Worker ${workerId} error:`, error);
        });
    }

    /**
     * Stop load test worker
     * @param {number} workerId - Worker ID
     * @param {Map} workers - Workers map
     */
    stopLoadWorker(workerId, workers) {
        const worker = workers.get(workerId);
        if (worker) {
            worker.active = false;
            workers.delete(workerId);
        }
    }

    /**
     * Execute load test request
     * @param {Object} target - Target configuration
     * @returns {Promise<*>} Request result
     */
    async executeLoadRequest(target) {
        if (target.type === 'http') {
            const response = await fetch(target.url, target.options || {});
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response;
        } else if (target.type === 'function') {
            return await target.fn();
        }
        
        throw new Error(`Unsupported target type: ${target.type}`);
    }

    /**
     * Aggregate load test metrics
     * @param {Array} phases - Phase results
     * @returns {Object} Aggregated metrics
     */
    aggregateLoadTestMetrics(phases) {
        const allRequests = phases.flatMap(phase => phase.requests);
        
        const totalRequests = allRequests.length;
        const successfulRequests = allRequests.filter(req => req.success).length;
        const failedRequests = totalRequests - successfulRequests;
        
        const responseTimes = allRequests.map(req => req.duration);
        const averageResponseTime = responseTimes.length > 0 
            ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length 
            : 0;
        
        const totalDuration = phases.reduce((sum, phase) => 
            sum + (phase.endTime - phase.startTime), 0);
        const throughput = totalDuration > 0 ? (totalRequests / totalDuration) * 1000 : 0;
        
        const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;
        
        return {
            totalRequests,
            successfulRequests,
            failedRequests,
            averageResponseTime,
            throughput,
            errorRate
        };
    }

    /**
     * Detect performance regression
     * @param {string} benchmarkName - Benchmark name
     * @param {Object} currentResults - Current results
     * @returns {Promise<Object>} Regression analysis
     */
    async detectRegression(benchmarkName, currentResults) {
        const historical = this.historicalResults.get(benchmarkName) || [];
        
        if (historical.length < 5) {
            // Not enough historical data
            return { hasRegression: false, reason: 'Insufficient historical data' };
        }
        
        const currentMean = currentResults.statistics.mean;
        const historicalMeans = historical.map(result => result.statistics.mean);
        
        // Use statistical test to detect regression
        const regression = this.analyzers.regression.detect(historicalMeans, currentMean);
        
        if (regression.hasRegression) {
            this.metrics.performanceRegressions++;
        }
        
        return regression;
    }

    /**
     * Start memory monitoring
     */
    startMemoryMonitoring() {
        setInterval(() => {
            const usage = process.memoryUsage();
            
            // Detect potential memory leaks
            if (usage.heapUsed > usage.heapTotal * 0.9) {
                this.metrics.memoryLeaksDetected++;
                this.emit('memory-leak-detected', { usage });
            }
        }, 5000);
    }

    /**
     * Setup CPU profiling
     */
    setupCpuProfiling() {
        // CPU profiling setup would go here
        // This is a simplified placeholder
    }

    /**
     * Start memory profiling
     * @param {string} name - Profile name
     * @returns {Object} Profiler handle
     */
    startMemoryProfiling(name) {
        return {
            name,
            startTime: Date.now(),
            startMemory: process.memoryUsage()
        };
    }

    /**
     * Stop memory profiling
     * @param {Object} profiler - Profiler handle
     * @returns {Object} Memory profile
     */
    async stopMemoryProfiling(profiler) {
        const endMemory = process.memoryUsage();
        
        return {
            name: profiler.name,
            duration: Date.now() - profiler.startTime,
            memoryDelta: {
                heapUsed: endMemory.heapUsed - profiler.startMemory.heapUsed,
                heapTotal: endMemory.heapTotal - profiler.startMemory.heapTotal,
                external: endMemory.external - profiler.startMemory.external
            },
            peakMemory: endMemory
        };
    }

    /**
     * Start CPU profiling
     * @param {string} name - Profile name
     * @returns {Object} Profiler handle
     */
    startCpuProfiling(name) {
        return {
            name,
            startTime: Date.now(),
            startCpuUsage: process.cpuUsage()
        };
    }

    /**
     * Stop CPU profiling
     * @param {Object} profiler - Profiler handle
     * @returns {Object} CPU profile
     */
    async stopCpuProfiling(profiler) {
        const endCpuUsage = process.cpuUsage(profiler.startCpuUsage);
        
        return {
            name: profiler.name,
            duration: Date.now() - profiler.startTime,
            cpuTime: {
                user: endCpuUsage.user,
                system: endCpuUsage.system,
                total: endCpuUsage.user + endCpuUsage.system
            }
        };
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
                reject(new Error(`Benchmark timed out after ${timeout}ms`));
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
     * Sleep for specified duration
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get benchmark results
     * @param {string} name - Benchmark name
     * @returns {Array} Benchmark results
     */
    getResults(name) {
        return this.results.get(name) || [];
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            registeredBenchmarks: this.benchmarks.size,
            registeredSuites: this.suites.size,
            totalResults: Array.from(this.results.values()).reduce((sum, results) => sum + results.length, 0)
        };
    }

    /**
     * Generate performance report
     * @returns {Object} Performance report
     */
    generateReport() {
        const report = {
            summary: this.getMetrics(),
            benchmarks: {},
            trends: {},
            regressions: []
        };
        
        // Add benchmark results
        for (const [name, results] of this.results) {
            if (results.length > 0) {
                const latest = results[results.length - 1];
                report.benchmarks[name] = {
                    latestResults: latest,
                    historicalCount: results.length,
                    trend: this.analyzers.trend.analyze(
                        results.map(r => r.statistics.mean)
                    )
                };
            }
        }
        
        return report;
    }

    /**
     * Shutdown benchmark suite
     */
    async shutdown() {
        this.emit('shutdown');
    }
}

// Statistical analysis classes (simplified implementations)
class DescriptiveStatistics {
    analyze(data) {
        if (data.length === 0) return {};
        
        const sorted = [...data].sort((a, b) => a - b);
        const sum = data.reduce((a, b) => a + b, 0);
        const mean = sum / data.length;
        
        const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
        const stddev = Math.sqrt(variance);
        
        return {
            count: data.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            mean,
            median: sorted[Math.floor(sorted.length / 2)],
            stddev,
            variance,
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)]
        };
    }
}

class RegressionAnalyzer {
    detect(historical, current) {
        if (historical.length < 3) {
            return { hasRegression: false, reason: 'Insufficient data' };
        }
        
        const historicalMean = historical.reduce((a, b) => a + b, 0) / historical.length;
        const threshold = historicalMean * 1.2; // 20% regression threshold
        
        return {
            hasRegression: current > threshold,
            severity: current > threshold ? ((current - historicalMean) / historicalMean) * 100 : 0,
            threshold,
            current,
            historical: historicalMean
        };
    }
}

class OutlierDetector {
    detect(data) {
        if (data.length < 4) return [];
        
        const sorted = [...data].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;
        
        return data.filter(val => val < lowerBound || val > upperBound);
    }
}

class TrendAnalyzer {
    analyze(data) {
        if (data.length < 2) return { trend: 'insufficient-data' };
        
        const recent = data.slice(-5); // Last 5 data points
        const older = data.slice(-10, -5); // Previous 5 data points
        
        if (older.length === 0) return { trend: 'insufficient-data' };
        
        const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderMean = older.reduce((a, b) => a + b, 0) / older.length;
        
        const change = ((recentMean - olderMean) / olderMean) * 100;
        
        if (Math.abs(change) < 5) return { trend: 'stable', change };
        if (change > 0) return { trend: 'degrading', change };
        return { trend: 'improving', change };
    }
}

module.exports = { 
    PerformanceBenchmark, 
    DescriptiveStatistics, 
    RegressionAnalyzer, 
    OutlierDetector, 
    TrendAnalyzer 
};
