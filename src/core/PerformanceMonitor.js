/**
 * Enterprise Performance Monitor with ML Predictions
 * Real-time performance analysis with predictive anomaly detection
 * Features: Time-series analysis, resource forecasting, adaptive thresholds
 */
class PerformanceMonitor {
    constructor(options = {}) {
        this.name = options.name || 'performance';
        this.sampleInterval = options.sampleInterval || 1000; // 1 second
        this.historySize = options.historySize || 3600; // 1 hour of samples
        this.predictionWindow = options.predictionWindow || 300; // 5 minutes ahead
        
        // Time-series data storage
        this.timeSeries = {
            cpu: new CircularBuffer(this.historySize),
            memory: new CircularBuffer(this.historySize),
            eventLoop: new CircularBuffer(this.historySize),
            gc: new CircularBuffer(this.historySize),
            network: new CircularBuffer(this.historySize),
            custom: new Map()
        };
        
        // Performance baselines
        this.baselines = {
            cpu: { mean: 0, stddev: 0, threshold: 80 },
            memory: { mean: 0, stddev: 0, threshold: 85 },
            eventLoop: { mean: 0, stddev: 0, threshold: 100 },
            gc: { mean: 0, stddev: 0, threshold: 50 }
        };
        
        // Anomaly detection
        this.anomalyDetector = {
            enabled: options.anomalyDetection !== false,
            sensitivity: options.sensitivity || 2.5, // Standard deviations
            windowSize: options.anomalyWindow || 60,
            alerts: []
        };
        
        // Predictive models
        this.models = {
            linear: new LinearRegressionModel(),
            exponential: new ExponentialSmoothingModel(),
            arima: new ARIMAModel()
        };
        
        // Performance alerts
        this.alerts = {
            handlers: new Map(),
            history: new CircularBuffer(1000),
            suppressionTime: 300000 // 5 minutes
        };
        
        // Resource tracking
        this.resources = {
            handles: new Map(),
            connections: new Map(),
            timers: new Map(),
            watchers: new Map()
        };
        
        // Start monitoring
        this.startMonitoring();
    }

    /**
     * Start performance monitoring
     */
    startMonitoring() {
        // Main sampling loop
        this.samplingInterval = setInterval(() => {
            this.collectSample();
        }, this.sampleInterval);
        
        // Baseline calculation
        this.baselineInterval = setInterval(() => {
            this.updateBaselines();
        }, 60000); // Every minute
        
        // Anomaly detection
        this.anomalyInterval = setInterval(() => {
            this.detectAnomalies();
        }, 10000); // Every 10 seconds
        
        // Prediction updates
        this.predictionInterval = setInterval(() => {
            this.updatePredictions();
        }, 30000); // Every 30 seconds
        
        // GC monitoring
        this.setupGCMonitoring();
        
        // Event loop monitoring
        this.setupEventLoopMonitoring();
    }

    /**
     * Collect performance sample
     */
    collectSample() {
        const timestamp = Date.now();
        
        // CPU usage
        const cpuUsage = process.cpuUsage();
        const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
        
        // Memory usage
        const memUsage = process.memoryUsage();
        const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        
        // Event loop lag
        const eventLoopLag = this.measureEventLoopLag();
        
        // Network stats (if available)
        const networkStats = this.getNetworkStats();
        
        // Store samples
        this.timeSeries.cpu.push({ timestamp, value: cpuPercent });
        this.timeSeries.memory.push({ timestamp, value: memPercent });
        this.timeSeries.eventLoop.push({ timestamp, value: eventLoopLag });
        this.timeSeries.network.push({ timestamp, value: networkStats });
        
        // Update resource tracking
        this.updateResourceTracking();
    }

    /**
     * Measure event loop lag
     * @returns {number} Event loop lag in milliseconds
     */
    measureEventLoopLag() {
        const start = process.hrtime.bigint();
        
        return new Promise(resolve => {
            setImmediate(() => {
                const lag = Number(process.hrtime.bigint() - start) / 1000000;
                resolve(lag);
            });
        });
    }

    /**
     * Get network statistics
     * @returns {Object} Network stats
     */
    getNetworkStats() {
        // Placeholder for network statistics
        // In production, this would integrate with system network monitoring
        return {
            bytesIn: 0,
            bytesOut: 0,
            connectionsActive: 0,
            connectionsTotal: 0
        };
    }

    /**
     * Update resource tracking
     */
    updateResourceTracking() {
        // Track active handles
        const handles = process._getActiveHandles();
        this.resources.handles.set(Date.now(), handles.length);
        
        // Track active requests
        const requests = process._getActiveRequests();
        this.resources.connections.set(Date.now(), requests.length);
        
        // Clean old entries
        this.cleanOldResourceEntries();
    }

    /**
     * Clean old resource tracking entries
     */
    cleanOldResourceEntries() {
        const cutoff = Date.now() - 3600000; // 1 hour
        
        for (const [timestamp] of this.resources.handles) {
            if (timestamp < cutoff) {
                this.resources.handles.delete(timestamp);
            }
        }
        
        for (const [timestamp] of this.resources.connections) {
            if (timestamp < cutoff) {
                this.resources.connections.delete(timestamp);
            }
        }
    }

    /**
     * Setup garbage collection monitoring
     */
    setupGCMonitoring() {
        if (global.gc) {
            const originalGC = global.gc;
            global.gc = (...args) => {
                const start = process.hrtime.bigint();
                const result = originalGC.apply(this, args);
                const duration = Number(process.hrtime.bigint() - start) / 1000000;
                
                this.timeSeries.gc.push({
                    timestamp: Date.now(),
                    value: duration,
                    type: 'manual'
                });
                
                return result;
            };
        }
        
        // Monitor GC events if available
        if (process.versions.v8) {
            try {
                const v8 = require('v8');
                const gcStats = v8.getHeapStatistics();
                
                setInterval(() => {
                    const newStats = v8.getHeapStatistics();
                    // Calculate GC pressure based on heap changes
                    const gcPressure = Math.abs(newStats.used_heap_size - gcStats.used_heap_size);
                    
                    this.timeSeries.gc.push({
                        timestamp: Date.now(),
                        value: gcPressure,
                        type: 'automatic'
                    });
                }, 5000);
            } catch (error) {
                // V8 stats not available
            }
        }
    }

    /**
     * Setup event loop monitoring
     */
    setupEventLoopMonitoring() {
        let lastCheck = process.hrtime.bigint();
        
        const checkEventLoop = () => {
            const now = process.hrtime.bigint();
            const lag = Number(now - lastCheck) / 1000000 - this.sampleInterval;
            
            if (lag > 0) {
                this.timeSeries.eventLoop.push({
                    timestamp: Date.now(),
                    value: lag
                });
            }
            
            lastCheck = now;
            setTimeout(checkEventLoop, this.sampleInterval);
        };
        
        checkEventLoop();
    }

    /**
     * Update performance baselines
     */
    updateBaselines() {
        for (const [metric, series] of Object.entries(this.timeSeries)) {
            if (series instanceof CircularBuffer && series.size() > 60) {
                const values = series.getAll().map(sample => sample.value);
                const stats = this.calculateStatistics(values);
                
                this.baselines[metric] = {
                    mean: stats.mean,
                    stddev: stats.stddev,
                    threshold: this.baselines[metric]?.threshold || stats.mean + (2 * stats.stddev)
                };
            }
        }
    }

    /**
     * Calculate statistical measures
     * @param {Array} values - Array of values
     * @returns {Object} Statistics
     */
    calculateStatistics(values) {
        const n = values.length;
        const mean = values.reduce((sum, val) => sum + val, 0) / n;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
        const stddev = Math.sqrt(variance);
        
        return {
            mean,
            variance,
            stddev,
            min: Math.min(...values),
            max: Math.max(...values),
            median: this.calculateMedian(values)
        };
    }

    /**
     * Calculate median value
     * @param {Array} values - Array of values
     * @returns {number} Median
     */
    calculateMedian(values) {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    /**
     * Detect performance anomalies
     */
    detectAnomalies() {
        if (!this.anomalyDetector.enabled) return;
        
        for (const [metric, series] of Object.entries(this.timeSeries)) {
            if (!(series instanceof CircularBuffer) || series.size() < this.anomalyDetector.windowSize) {
                continue;
            }
            
            const recent = series.getLast(this.anomalyDetector.windowSize);
            const baseline = this.baselines[metric];
            
            if (!baseline) continue;
            
            // Z-score anomaly detection
            for (const sample of recent) {
                const zScore = Math.abs(sample.value - baseline.mean) / baseline.stddev;
                
                if (zScore > this.anomalyDetector.sensitivity) {
                    this.reportAnomaly(metric, sample, zScore);
                }
            }
        }
    }

    /**
     * Report performance anomaly
     * @param {string} metric - Metric name
     * @param {Object} sample - Anomalous sample
     * @param {number} zScore - Z-score
     */
    reportAnomaly(metric, sample, zScore) {
        const anomaly = {
            metric,
            timestamp: sample.timestamp,
            value: sample.value,
            zScore,
            severity: this.calculateSeverity(zScore),
            baseline: this.baselines[metric]
        };
        
        this.anomalyDetector.alerts.push(anomaly);
        this.triggerAlert('anomaly', anomaly);
    }

    /**
     * Calculate anomaly severity
     * @param {number} zScore - Z-score
     * @returns {string} Severity level
     */
    calculateSeverity(zScore) {
        if (zScore > 4) return 'critical';
        if (zScore > 3) return 'high';
        if (zScore > 2.5) return 'medium';
        return 'low';
    }

    /**
     * Update predictive models
     */
    updatePredictions() {
        for (const [metric, series] of Object.entries(this.timeSeries)) {
            if (!(series instanceof CircularBuffer) || series.size() < 100) {
                continue;
            }
            
            const data = series.getAll();
            const predictions = {};
            
            // Linear regression prediction
            predictions.linear = this.models.linear.predict(data, this.predictionWindow);
            
            // Exponential smoothing prediction
            predictions.exponential = this.models.exponential.predict(data, this.predictionWindow);
            
            // ARIMA prediction (simplified)
            predictions.arima = this.models.arima.predict(data, this.predictionWindow);
            
            // Store predictions
            this.storePredictions(metric, predictions);
        }
    }

    /**
     * Store predictions for metric
     * @param {string} metric - Metric name
     * @param {Object} predictions - Prediction results
     */
    storePredictions(metric, predictions) {
        if (!this.predictions) {
            this.predictions = new Map();
        }
        
        this.predictions.set(metric, {
            timestamp: Date.now(),
            predictions,
            confidence: this.calculatePredictionConfidence(predictions)
        });
    }

    /**
     * Calculate prediction confidence
     * @param {Object} predictions - Prediction results
     * @returns {number} Confidence score (0-1)
     */
    calculatePredictionConfidence(predictions) {
        // Simple confidence calculation based on model agreement
        const values = Object.values(predictions).filter(p => p !== null);
        if (values.length < 2) return 0.5;
        
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        
        // Lower variance = higher confidence
        return Math.max(0, 1 - (variance / mean));
    }

    /**
     * Register alert handler
     * @param {string} type - Alert type
     * @param {Function} handler - Alert handler function
     */
    onAlert(type, handler) {
        if (!this.alerts.handlers.has(type)) {
            this.alerts.handlers.set(type, []);
        }
        this.alerts.handlers.get(type).push(handler);
    }

    /**
     * Trigger alert
     * @param {string} type - Alert type
     * @param {Object} data - Alert data
     */
    triggerAlert(type, data) {
        const alert = {
            type,
            data,
            timestamp: Date.now(),
            id: this.generateAlertId()
        };
        
        // Check suppression
        if (this.isAlertSuppressed(type, data)) {
            return;
        }
        
        this.alerts.history.push(alert);
        
        // Call handlers
        const handlers = this.alerts.handlers.get(type) || [];
        for (const handler of handlers) {
            try {
                handler(alert);
            } catch (error) {
                console.error('Alert handler error:', error);
            }
        }
    }

    /**
     * Check if alert should be suppressed
     * @param {string} type - Alert type
     * @param {Object} data - Alert data
     * @returns {boolean} Should suppress
     */
    isAlertSuppressed(type, data) {
        const cutoff = Date.now() - this.alerts.suppressionTime;
        const recent = this.alerts.history.getAll().filter(alert => 
            alert.timestamp > cutoff && 
            alert.type === type &&
            alert.data.metric === data.metric
        );
        
        return recent.length > 0;
    }

    /**
     * Generate unique alert ID
     * @returns {string} Alert ID
     */
    generateAlertId() {
        return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get performance statistics
     * @returns {Object} Performance stats
     */
    getStats() {
        const stats = {};
        
        for (const [metric, series] of Object.entries(this.timeSeries)) {
            if (series instanceof CircularBuffer && series.size() > 0) {
                const recent = series.getLast(60); // Last minute
                const values = recent.map(sample => sample.value);
                
                stats[metric] = {
                    current: values[values.length - 1],
                    average: values.reduce((sum, val) => sum + val, 0) / values.length,
                    min: Math.min(...values),
                    max: Math.max(...values),
                    baseline: this.baselines[metric],
                    samples: series.size()
                };
            }
        }
        
        return {
            metrics: stats,
            anomalies: this.anomalyDetector.alerts.length,
            predictions: this.predictions ? this.predictions.size : 0,
            alerts: this.alerts.history.size(),
            resources: {
                handles: this.resources.handles.size,
                connections: this.resources.connections.size
            }
        };
    }

    /**
     * Shutdown performance monitor
     */
    shutdown() {
        if (this.samplingInterval) clearInterval(this.samplingInterval);
        if (this.baselineInterval) clearInterval(this.baselineInterval);
        if (this.anomalyInterval) clearInterval(this.anomalyInterval);
        if (this.predictionInterval) clearInterval(this.predictionInterval);
        
        // Clear data
        for (const series of Object.values(this.timeSeries)) {
            if (series instanceof CircularBuffer) {
                series.clear();
            }
        }
        
        this.alerts.handlers.clear();
        this.alerts.history.clear();
    }
}

/**
 * Circular buffer for time-series data
 */
class CircularBuffer {
    constructor(size) {
        this.buffer = new Array(size);
        this.size_ = 0;
        this.index = 0;
        this.maxSize = size;
    }

    push(item) {
        this.buffer[this.index] = item;
        this.index = (this.index + 1) % this.maxSize;
        this.size_ = Math.min(this.size_ + 1, this.maxSize);
    }

    size() {
        return this.size_;
    }

    getAll() {
        if (this.size_ < this.maxSize) {
            return this.buffer.slice(0, this.size_);
        }
        
        return [
            ...this.buffer.slice(this.index),
            ...this.buffer.slice(0, this.index)
        ];
    }

    getLast(count) {
        const all = this.getAll();
        return all.slice(-count);
    }

    clear() {
        this.size_ = 0;
        this.index = 0;
    }
}

/**
 * Simple linear regression model
 */
class LinearRegressionModel {
    predict(data, steps) {
        if (data.length < 2) return null;
        
        const x = data.map((_, i) => i);
        const y = data.map(sample => sample.value);
        
        const n = data.length;
        const sumX = x.reduce((sum, val) => sum + val, 0);
        const sumY = y.reduce((sum, val) => sum + val, 0);
        const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
        const sumXX = x.reduce((sum, val) => sum + val * val, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        return slope * (n + steps) + intercept;
    }
}

/**
 * Simple exponential smoothing model
 */
class ExponentialSmoothingModel {
    predict(data, steps) {
        if (data.length < 2) return null;
        
        const alpha = 0.3; // Smoothing parameter
        let forecast = data[0].value;
        
        for (let i = 1; i < data.length; i++) {
            forecast = alpha * data[i].value + (1 - alpha) * forecast;
        }
        
        return forecast;
    }
}

/**
 * Simplified ARIMA model
 */
class ARIMAModel {
    predict(data, steps) {
        if (data.length < 10) return null;
        
        // Simple moving average as ARIMA approximation
        const window = Math.min(10, data.length);
        const recent = data.slice(-window);
        const average = recent.reduce((sum, sample) => sum + sample.value, 0) / window;
        
        return average;
    }
}

module.exports = { PerformanceMonitor, CircularBuffer };
