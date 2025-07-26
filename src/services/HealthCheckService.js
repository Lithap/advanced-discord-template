const logger = require('../utils/simple-logger.js');

/**
 * Enterprise Health Check Service
 * Comprehensive system health monitoring and reporting
 */
class HealthCheckService {
    constructor(application) {
        this.app = application;
        this.checks = new Map();
        this.history = [];
        this.maxHistorySize = 1000;
        this.alertThresholds = {
            critical: 0.5,  // 50% of checks failing
            warning: 0.2    // 20% of checks failing
        };
        this.lastCheck = null;
        this.isRunning = false;
        this.intervalId = null;
        this.checkInterval = 30000; // 30 seconds
    }

    /**
     * Register a health check
     */
    registerCheck(name, checkFunction, options = {}) {
        this.checks.set(name, {
            name,
            check: checkFunction,
            timeout: options.timeout || 5000,
            critical: options.critical || false,
            tags: options.tags || [],
            metadata: options.metadata || {}
        });

        logger.debug(`🏥 Registered health check: ${name}`);
        return this;
    }

    /**
     * Start continuous health monitoring
     */
    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.intervalId = setInterval(() => {
            this.performHealthCheck().catch(error => {
                logger.error('Health check error:', error);
            });
        }, this.checkInterval);

        logger.info('🏥 Health monitoring started');
    }

    /**
     * Stop health monitoring
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        logger.info('🏥 Health monitoring stopped');
    }

    /**
     * Perform comprehensive health check
     */
    async performHealthCheck() {
        const startTime = Date.now();
        const results = new Map();
        let totalChecks = 0;
        let passedChecks = 0;
        let criticalFailures = 0;

        // Run all registered checks
        for (const [name, checkConfig] of this.checks) {
            totalChecks++;
            
            try {
                const checkStartTime = Date.now();
                
                // Run check with timeout
                const result = await Promise.race([
                    checkConfig.check(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Health check timeout')), checkConfig.timeout)
                    )
                ]);

                const duration = Date.now() - checkStartTime;
                
                results.set(name, {
                    name,
                    status: 'healthy',
                    duration,
                    result,
                    timestamp: new Date().toISOString(),
                    critical: checkConfig.critical,
                    tags: checkConfig.tags
                });

                passedChecks++;

            } catch (error) {
                const duration = Date.now() - checkStartTime;
                
                results.set(name, {
                    name,
                    status: 'unhealthy',
                    duration,
                    error: error.message,
                    timestamp: new Date().toISOString(),
                    critical: checkConfig.critical,
                    tags: checkConfig.tags
                });

                if (checkConfig.critical) {
                    criticalFailures++;
                }

                logger.warn(`🚨 Health check failed: ${name} - ${error.message}`);
            }
        }

        // Calculate overall health
        const healthScore = totalChecks > 0 ? passedChecks / totalChecks : 1;
        const overallStatus = this.determineOverallStatus(healthScore, criticalFailures);

        const healthReport = {
            status: overallStatus,
            score: healthScore,
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
            checks: Object.fromEntries(results),
            summary: {
                total: totalChecks,
                passed: passedChecks,
                failed: totalChecks - passedChecks,
                criticalFailures
            }
        };

        // Store in history
        this.addToHistory(healthReport);
        this.lastCheck = healthReport;

        // Emit health events
        if (this.app.eventBus) {
            this.app.eventBus.emit('health.check.completed', healthReport);
            
            if (overallStatus !== 'healthy') {
                this.app.eventBus.emit('health.alert', {
                    level: overallStatus,
                    report: healthReport
                });
            }
        }

        return healthReport;
    }

    /**
     * Determine overall system status
     */
    determineOverallStatus(healthScore, criticalFailures) {
        if (criticalFailures > 0) {
            return 'critical';
        }
        
        if (healthScore < this.alertThresholds.critical) {
            return 'critical';
        }
        
        if (healthScore < this.alertThresholds.warning) {
            return 'warning';
        }
        
        return 'healthy';
    }

    /**
     * Add health report to history
     */
    addToHistory(report) {
        this.history.push(report);
        
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    /**
     * Get current health status
     */
    getHealth() {
        return this.lastCheck || {
            status: 'unknown',
            message: 'No health checks performed yet'
        };
    }

    /**
     * Get health history
     */
    getHistory(limit = 100) {
        return this.history.slice(-limit);
    }

    /**
     * Get health statistics
     */
    getStats() {
        if (this.history.length === 0) {
            return { message: 'No health data available' };
        }

        const recentChecks = this.history.slice(-100);
        const healthyChecks = recentChecks.filter(check => check.status === 'healthy').length;
        const uptime = healthyChecks / recentChecks.length;

        return {
            registeredChecks: this.checks.size,
            totalChecks: this.history.length,
            uptime: Math.round(uptime * 100) / 100,
            lastCheck: this.lastCheck?.timestamp,
            averageDuration: this.calculateAverageDuration(recentChecks),
            isMonitoring: this.isRunning
        };
    }

    /**
     * Calculate average check duration
     */
    calculateAverageDuration(checks) {
        if (checks.length === 0) return 0;
        
        const totalDuration = checks.reduce((sum, check) => sum + (check.duration || 0), 0);
        return Math.round(totalDuration / checks.length);
    }

    /**
     * Register default system health checks
     */
    registerDefaultChecks() {
        // Discord client health
        this.registerCheck('discord', async () => {
            if (!this.app.client || !this.app.client.readyAt) {
                throw new Error('Discord client not ready');
            }
            
            return {
                status: 'connected',
                ping: this.app.client.ws.ping,
                guilds: this.app.client.guilds.cache.size,
                uptime: Date.now() - this.app.client.readyTimestamp
            };
        }, { critical: true, tags: ['discord', 'connectivity'] });

        // Database health
        this.registerCheck('database', async () => {
            if (!this.app.databaseService) {
                throw new Error('Database service not available');
            }
            
            const health = await this.app.databaseService.healthCheck();
            if (!health.healthy) {
                throw new Error(health.message);
            }
            
            return health;
        }, { critical: true, tags: ['database', 'storage'] });

        // Memory health
        this.registerCheck('memory', async () => {
            const usage = process.memoryUsage();
            const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
            const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
            const utilization = heapUsedMB / heapTotalMB;
            
            if (utilization > 0.9) {
                throw new Error(`High memory usage: ${Math.round(utilization * 100)}%`);
            }
            
            return {
                heapUsed: heapUsedMB,
                heapTotal: heapTotalMB,
                utilization: Math.round(utilization * 100) / 100
            };
        }, { tags: ['system', 'memory'] });

        logger.info('🏥 Default health checks registered');
    }
}

module.exports = HealthCheckService;
