/**
 * Enterprise Async Pipeline with Backpressure Control
 * Implements reactive streams with flow control, batching, and parallel processing
 * Features: Adaptive batching, priority queues, resource-aware scheduling
 */
class AsyncPipeline {
    constructor(options = {}) {
        this.name = options.name || 'pipeline';
        this.concurrency = options.concurrency || require('os').cpus().length;
        this.maxQueueSize = options.maxQueueSize || 10000;
        this.batchSize = options.batchSize || 100;
        this.batchTimeout = options.batchTimeout || 1000;
        this.backpressureThreshold = options.backpressureThreshold || 0.8;
        
        // Pipeline stages
        this.stages = [];
        this.processors = new Map();
        
        // Queue management with priority support
        this.queues = {
            high: [],
            normal: [],
            low: []
        };
        this.processing = new Set();
        this.completed = new Map();
        this.failed = new Map();
        
        // Backpressure control
        this.backpressure = {
            active: false,
            level: 0,
            adaptiveBatching: true,
            currentBatchSize: this.batchSize
        };
        
        // Performance metrics
        this.metrics = {
            processed: 0,
            failed: 0,
            queued: 0,
            avgProcessingTime: 0,
            throughput: 0,
            backpressureEvents: 0,
            resourceUtilization: 0
        };
        
        // Resource monitoring
        this.resourceMonitor = {
            cpuUsage: 0,
            memoryUsage: 0,
            eventLoopDelay: 0,
            gcPressure: 0
        };
        
        // Adaptive scheduling
        this.scheduler = {
            algorithm: options.schedulingAlgorithm || 'fair',
            weights: { high: 3, normal: 2, low: 1 },
            roundRobinIndex: 0
        };
        
        // Start monitoring and processing
        this.startResourceMonitoring();
        this.startProcessing();
    }

    /**
     * Add processing stage to pipeline
     * @param {string} name - Stage name
     * @param {Function} processor - Processing function
     * @param {Object} options - Stage options
     */
    addStage(name, processor, options = {}) {
        const stage = {
            name,
            processor,
            options: {
                parallel: options.parallel !== false,
                retries: options.retries || 3,
                timeout: options.timeout || 30000,
                errorHandler: options.errorHandler || this.defaultErrorHandler.bind(this),
                ...options
            }
        };
        
        this.stages.push(stage);
        this.processors.set(name, stage);
        
        return this;
    }

    /**
     * Process item through pipeline
     * @param {*} item - Item to process
     * @param {Object} options - Processing options
     * @returns {Promise} Processing promise
     */
    async process(item, options = {}) {
        const taskId = this.generateTaskId();
        const priority = options.priority || 'normal';
        
        const task = {
            id: taskId,
            item,
            priority,
            options,
            createdAt: Date.now(),
            stages: [...this.stages],
            currentStage: 0,
            results: [],
            retries: 0
        };
        
        // Check backpressure
        if (this.shouldApplyBackpressure()) {
            throw new BackpressureError('Pipeline is under backpressure');
        }
        
        // Add to appropriate queue
        this.queues[priority].push(task);
        this.metrics.queued++;
        
        return new Promise((resolve, reject) => {
            task.resolve = resolve;
            task.reject = reject;
        });
    }

    /**
     * Process batch of items
     * @param {Array} items - Items to process
     * @param {Object} options - Batch options
     * @returns {Promise<Array>} Processing results
     */
    async processBatch(items, options = {}) {
        const batchId = this.generateTaskId();
        const promises = items.map((item, index) => 
            this.process(item, { ...options, batchId, batchIndex: index })
        );
        
        if (options.failFast) {
            return Promise.all(promises);
        } else {
            return Promise.allSettled(promises);
        }
    }

    /**
     * Start processing loop
     */
    startProcessing() {
        this.processingInterval = setInterval(async () => {
            await this.processNextBatch();
        }, 10); // High frequency processing
        
        // Batch timeout processing
        this.batchTimeoutInterval = setInterval(() => {
            this.processPendingBatches();
        }, this.batchTimeout);
    }

    /**
     * Process next batch of tasks
     */
    async processNextBatch() {
        if (this.processing.size >= this.concurrency) {
            return; // At capacity
        }
        
        const tasks = this.getNextTasks();
        if (tasks.length === 0) {
            return; // No tasks
        }
        
        // Process tasks in parallel
        const processingPromises = tasks.map(task => this.processTask(task));
        await Promise.allSettled(processingPromises);
    }

    /**
     * Get next tasks based on scheduling algorithm
     * @returns {Array} Tasks to process
     */
    getNextTasks() {
        const availableSlots = this.concurrency - this.processing.size;
        const batchSize = Math.min(
            availableSlots,
            this.backpressure.currentBatchSize
        );
        
        if (batchSize <= 0) {
            return [];
        }
        
        switch (this.scheduler.algorithm) {
            case 'priority':
                return this.getTasksByPriority(batchSize);
            case 'fair':
                return this.getTasksFairly(batchSize);
            case 'weighted':
                return this.getTasksByWeight(batchSize);
            default:
                return this.getTasksFairly(batchSize);
        }
    }

    /**
     * Get tasks by priority (high -> normal -> low)
     * @param {number} count - Number of tasks to get
     * @returns {Array} Tasks
     */
    getTasksByPriority(count) {
        const tasks = [];
        
        // High priority first
        while (tasks.length < count && this.queues.high.length > 0) {
            tasks.push(this.queues.high.shift());
        }
        
        // Normal priority
        while (tasks.length < count && this.queues.normal.length > 0) {
            tasks.push(this.queues.normal.shift());
        }
        
        // Low priority
        while (tasks.length < count && this.queues.low.length > 0) {
            tasks.push(this.queues.low.shift());
        }
        
        return tasks;
    }

    /**
     * Get tasks fairly (round-robin)
     * @param {number} count - Number of tasks to get
     * @returns {Array} Tasks
     */
    getTasksFairly(count) {
        const tasks = [];
        const queueNames = ['high', 'normal', 'low'];
        
        while (tasks.length < count) {
            let foundTask = false;
            
            for (let i = 0; i < queueNames.length; i++) {
                const queueIndex = (this.scheduler.roundRobinIndex + i) % queueNames.length;
                const queueName = queueNames[queueIndex];
                const queue = this.queues[queueName];
                
                if (queue.length > 0) {
                    tasks.push(queue.shift());
                    foundTask = true;
                    break;
                }
            }
            
            if (!foundTask) {
                break; // No more tasks
            }
            
            this.scheduler.roundRobinIndex = (this.scheduler.roundRobinIndex + 1) % queueNames.length;
        }
        
        return tasks;
    }

    /**
     * Get tasks by weighted priority
     * @param {number} count - Number of tasks to get
     * @returns {Array} Tasks
     */
    getTasksByWeight(count) {
        const tasks = [];
        const totalWeight = Object.values(this.scheduler.weights).reduce((a, b) => a + b, 0);
        
        for (const [priority, weight] of Object.entries(this.scheduler.weights)) {
            const proportion = weight / totalWeight;
            const tasksFromQueue = Math.floor(count * proportion);
            
            for (let i = 0; i < tasksFromQueue && this.queues[priority].length > 0; i++) {
                tasks.push(this.queues[priority].shift());
            }
        }
        
        return tasks;
    }

    /**
     * Process individual task through all stages
     * @param {Object} task - Task to process
     */
    async processTask(task) {
        this.processing.add(task.id);
        const startTime = process.hrtime.bigint();
        
        try {
            // Process through each stage
            for (let i = task.currentStage; i < task.stages.length; i++) {
                const stage = task.stages[i];
                const result = await this.processStage(task, stage);
                task.results.push(result);
                task.currentStage = i + 1;
            }
            
            // Task completed successfully
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000;
            this.recordSuccess(task, duration);
            task.resolve(task.results);
            
        } catch (error) {
            // Handle task failure
            const duration = Number(process.hrtime.bigint() - startTime) / 1000000;
            this.recordFailure(task, error, duration);
            task.reject(error);
        } finally {
            this.processing.delete(task.id);
            this.metrics.queued--;
        }
    }

    /**
     * Process task through single stage
     * @param {Object} task - Task object
     * @param {Object} stage - Stage configuration
     * @returns {*} Stage result
     */
    async processStage(task, stage) {
        const { processor, options } = stage;
        
        // Apply timeout if specified
        if (options.timeout) {
            return this.withTimeout(
                processor(task.item, task.results, task.options),
                options.timeout
            );
        }
        
        return processor(task.item, task.results, task.options);
    }

    /**
     * Execute promise with timeout
     * @param {Promise} promise - Promise to execute
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise} Promise with timeout
     */
    withTimeout(promise, timeout) {
        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                reject(new Error(`Stage timeout after ${timeout}ms`));
            }, timeout);
            
            promise
                .then(result => {
                    clearTimeout(timeoutHandle);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeoutHandle);
                    reject(error);
                });
        });
    }

    /**
     * Check if backpressure should be applied
     * @returns {boolean} Should apply backpressure
     */
    shouldApplyBackpressure() {
        const totalQueued = Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0);
        const queueUtilization = totalQueued / this.maxQueueSize;
        
        this.backpressure.level = queueUtilization;
        this.backpressure.active = queueUtilization > this.backpressureThreshold;
        
        // Adaptive batch sizing
        if (this.backpressure.adaptiveBatching) {
            if (queueUtilization > 0.9) {
                this.backpressure.currentBatchSize = Math.max(1, this.batchSize * 0.5);
            } else if (queueUtilization < 0.3) {
                this.backpressure.currentBatchSize = Math.min(this.batchSize * 2, this.batchSize);
            }
        }
        
        return this.backpressure.active;
    }

    /**
     * Start resource monitoring
     */
    startResourceMonitoring() {
        this.resourceInterval = setInterval(() => {
            this.updateResourceMetrics();
        }, 1000);
    }

    /**
     * Update resource utilization metrics
     */
    updateResourceMetrics() {
        const usage = process.cpuUsage();
        const memUsage = process.memoryUsage();
        
        this.resourceMonitor.cpuUsage = (usage.user + usage.system) / 1000000; // Convert to seconds
        this.resourceMonitor.memoryUsage = memUsage.heapUsed / memUsage.heapTotal;
        
        // Calculate throughput
        const now = Date.now();
        if (this.lastMetricsUpdate) {
            const timeDiff = (now - this.lastMetricsUpdate) / 1000;
            const processedDiff = this.metrics.processed - (this.lastProcessedCount || 0);
            this.metrics.throughput = processedDiff / timeDiff;
        }
        
        this.lastMetricsUpdate = now;
        this.lastProcessedCount = this.metrics.processed;
    }

    /**
     * Record successful task completion
     * @param {Object} task - Completed task
     * @param {number} duration - Processing duration
     */
    recordSuccess(task, duration) {
        this.metrics.processed++;
        this.updateAverageProcessingTime(duration);
        this.completed.set(task.id, { task, duration, completedAt: Date.now() });
    }

    /**
     * Record task failure
     * @param {Object} task - Failed task
     * @param {Error} error - Error object
     * @param {number} duration - Processing duration
     */
    recordFailure(task, error, duration) {
        this.metrics.failed++;
        this.updateAverageProcessingTime(duration);
        this.failed.set(task.id, { task, error, duration, failedAt: Date.now() });
    }

    /**
     * Update average processing time
     * @param {number} duration - New duration sample
     */
    updateAverageProcessingTime(duration) {
        const totalProcessed = this.metrics.processed + this.metrics.failed;
        this.metrics.avgProcessingTime = 
            (this.metrics.avgProcessingTime * (totalProcessed - 1) + duration) / totalProcessed;
    }

    /**
     * Generate unique task ID
     * @returns {string} Task ID
     */
    generateTaskId() {
        return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Default error handler
     * @param {Error} error - Error object
     * @param {Object} task - Task object
     */
    defaultErrorHandler(error, task) {
        console.error(`Pipeline ${this.name} error in task ${task.id}:`, error);
    }

    /**
     * Get pipeline statistics
     * @returns {Object} Pipeline statistics
     */
    getStats() {
        const totalQueued = Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0);
        
        return {
            name: this.name,
            stages: this.stages.length,
            concurrency: this.concurrency,
            processing: this.processing.size,
            queued: {
                total: totalQueued,
                high: this.queues.high.length,
                normal: this.queues.normal.length,
                low: this.queues.low.length
            },
            metrics: this.metrics,
            backpressure: this.backpressure,
            resourceMonitor: this.resourceMonitor
        };
    }

    /**
     * Shutdown pipeline
     */
    async shutdown() {
        // Stop processing
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
        }
        if (this.batchTimeoutInterval) {
            clearInterval(this.batchTimeoutInterval);
        }
        if (this.resourceInterval) {
            clearInterval(this.resourceInterval);
        }
        
        // Wait for current processing to complete
        while (this.processing.size > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Clear queues
        Object.values(this.queues).forEach(queue => queue.length = 0);
        this.completed.clear();
        this.failed.clear();
    }
}

class BackpressureError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BackpressureError';
    }
}

module.exports = { AsyncPipeline, BackpressureError };
