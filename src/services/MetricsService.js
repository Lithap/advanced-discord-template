const logger = require('../utils/simple-logger.js');

/**
 * Enterprise Metrics and Analytics Service
 * Real-time metrics collection, aggregation, and analysis
 */
class MetricsService {
    constructor(options = {}) {
        this.metrics = new Map();
        this.timeSeries = new Map();
        this.aggregations = new Map();
        this.alerts = new Map();
        
        // Configuration
        this.retentionPeriod = options.retentionPeriod || 24 * 60 * 60 * 1000; // 24 hours
        this.aggregationInterval = options.aggregationInterval || 60000; // 1 minute
        this.maxDataPoints = options.maxDataPoints || 10000;
        
        // State
        this.isRunning = false;
        this.aggregationTimer = null;
        this.cleanupTimer = null;
        
        // Metric types
        this.METRIC_TYPES = {
            COUNTER: 'counter',
            GAUGE: 'gauge',
            HISTOGRAM: 'histogram',
            TIMER: 'timer'
        };
    }

    /**
     * Start metrics collection
     */
    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        
        // Start aggregation timer
        this.aggregationTimer = setInterval(() => {
            this.performAggregation();
        }, this.aggregationInterval);

        // Start cleanup timer (every hour)
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, 60 * 60 * 1000);

        logger.info('📊 Metrics service started');
    }

    /**
     * Stop metrics collection
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        
        if (this.aggregationTimer) {
            clearInterval(this.aggregationTimer);
            this.aggregationTimer = null;
        }

        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        logger.info('📊 Metrics service stopped');
    }

    /**
     * Record a counter metric
     */
    counter(name, value = 1, tags = {}) {
        this.recordMetric(name, value, this.METRIC_TYPES.COUNTER, tags);
    }

    /**
     * Record a gauge metric
     */
    gauge(name, value, tags = {}) {
        this.recordMetric(name, value, this.METRIC_TYPES.GAUGE, tags);
    }

    /**
     * Record a histogram metric
     */
    histogram(name, value, tags = {}) {
        this.recordMetric(name, value, this.METRIC_TYPES.HISTOGRAM, tags);
    }

    /**
     * Time a function execution
     */
    async timer(name, fn, tags = {}) {
        const startTime = Date.now();
        
        try {
            const result = await fn();
            const duration = Date.now() - startTime;
            this.recordMetric(name, duration, this.METRIC_TYPES.TIMER, tags);
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            this.recordMetric(name, duration, this.METRIC_TYPES.TIMER, { ...tags, error: true });
            throw error;
        }
    }

    /**
     * Record a metric data point
     */
    recordMetric(name, value, type, tags = {}) {
        const timestamp = Date.now();
        const metricKey = this.getMetricKey(name, tags);
        
        // Initialize metric if not exists
        if (!this.metrics.has(metricKey)) {
            this.metrics.set(metricKey, {
                name,
                type,
                tags,
                values: [],
                lastValue: null,
                count: 0,
                sum: 0,
                min: null,
                max: null
            });
        }

        const metric = this.metrics.get(metricKey);
        
        // Update metric data
        metric.values.push({ value, timestamp });
        metric.lastValue = value;
        metric.count++;
        
        if (type === this.METRIC_TYPES.COUNTER) {
            metric.sum += value;
        } else {
            metric.sum = value; // For gauges, sum is the current value
        }
        
        if (metric.min === null || value < metric.min) {
            metric.min = value;
        }
        
        if (metric.max === null || value > metric.max) {
            metric.max = value;
        }

        // Limit data points
        if (metric.values.length > this.maxDataPoints) {
            metric.values.shift();
        }

        // Add to time series
        this.addToTimeSeries(metricKey, value, timestamp);
    }

    /**
     * Add data point to time series
     */
    addToTimeSeries(metricKey, value, timestamp) {
        if (!this.timeSeries.has(metricKey)) {
            this.timeSeries.set(metricKey, []);
        }

        const series = this.timeSeries.get(metricKey);
        series.push({ value, timestamp });

        // Limit time series data
        if (series.length > this.maxDataPoints) {
            series.shift();
        }
    }

    /**
     * Get metric key with tags
     */
    getMetricKey(name, tags) {
        const tagString = Object.keys(tags)
            .sort()
            .map(key => `${key}=${tags[key]}`)
            .join(',');
        
        return tagString ? `${name}{${tagString}}` : name;
    }

    /**
     * Get metric data
     */
    getMetric(name, tags = {}) {
        const metricKey = this.getMetricKey(name, tags);
        return this.metrics.get(metricKey);
    }

    /**
     * Get all metrics
     */
    getAllMetrics() {
        const result = {};
        
        for (const [key, metric] of this.metrics) {
            result[key] = {
                name: metric.name,
                type: metric.type,
                tags: metric.tags,
                lastValue: metric.lastValue,
                count: metric.count,
                sum: metric.sum,
                min: metric.min,
                max: metric.max,
                average: metric.count > 0 ? metric.sum / metric.count : 0
            };
        }
        
        return result;
    }

    /**
     * Get time series data
     */
    getTimeSeries(name, tags = {}, duration = 3600000) { // 1 hour default
        const metricKey = this.getMetricKey(name, tags);
        const series = this.timeSeries.get(metricKey) || [];
        const cutoff = Date.now() - duration;
        
        return series.filter(point => point.timestamp >= cutoff);
    }

    /**
     * Perform metric aggregations
     */
    performAggregation() {
        const now = Date.now();
        const aggregationKey = Math.floor(now / this.aggregationInterval);
        
        for (const [metricKey, metric] of this.metrics) {
            const recentValues = metric.values.filter(
                point => point.timestamp >= now - this.aggregationInterval
            );
            
            if (recentValues.length === 0) continue;
            
            const aggregation = {
                timestamp: aggregationKey * this.aggregationInterval,
                count: recentValues.length,
                sum: recentValues.reduce((sum, point) => sum + point.value, 0),
                min: Math.min(...recentValues.map(point => point.value)),
                max: Math.max(...recentValues.map(point => point.value)),
                average: 0
            };
            
            aggregation.average = aggregation.sum / aggregation.count;
            
            if (!this.aggregations.has(metricKey)) {
                this.aggregations.set(metricKey, []);
            }
            
            this.aggregations.get(metricKey).push(aggregation);
        }
    }

    /**
     * Clean up old data
     */
    cleanup() {
        const cutoff = Date.now() - this.retentionPeriod;
        let cleanedPoints = 0;
        
        // Clean up metrics
        for (const [key, metric] of this.metrics) {
            const originalLength = metric.values.length;
            metric.values = metric.values.filter(point => point.timestamp >= cutoff);
            cleanedPoints += originalLength - metric.values.length;
        }
        
        // Clean up time series
        for (const [key, series] of this.timeSeries) {
            const originalLength = series.length;
            const filtered = series.filter(point => point.timestamp >= cutoff);
            this.timeSeries.set(key, filtered);
            cleanedPoints += originalLength - filtered.length;
        }
        
        // Clean up aggregations
        for (const [key, aggregations] of this.aggregations) {
            const originalLength = aggregations.length;
            const filtered = aggregations.filter(agg => agg.timestamp >= cutoff);
            this.aggregations.set(key, filtered);
            cleanedPoints += originalLength - filtered.length;
        }
        
        if (cleanedPoints > 0) {
            logger.debug(`🧹 Cleaned up ${cleanedPoints} old metric data points`);
        }
    }

    /**
     * Get service statistics
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            totalMetrics: this.metrics.size,
            totalDataPoints: Array.from(this.metrics.values())
                .reduce((sum, metric) => sum + metric.values.length, 0),
            timeSeriesPoints: Array.from(this.timeSeries.values())
                .reduce((sum, series) => sum + series.length, 0),
            aggregations: Array.from(this.aggregations.values())
                .reduce((sum, aggs) => sum + aggs.length, 0),
            retentionPeriod: this.retentionPeriod,
            aggregationInterval: this.aggregationInterval
        };
    }
}

module.exports = MetricsService;
