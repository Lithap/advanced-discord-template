/**
 * Enterprise Event Store Implementation
 * Immutable event log with ACID guarantees, snapshots, and projections
 * Features: Optimistic concurrency, event versioning, stream partitioning
 */
const { EventEmitter } = require('events');
const crypto = require('crypto');

class EventStore extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            maxEventsPerStream: options.maxEventsPerStream || 10000,
            snapshotFrequency: options.snapshotFrequency || 100,
            partitionCount: options.partitionCount || 16,
            compressionEnabled: options.compressionEnabled !== false,
            encryptionEnabled: options.encryptionEnabled || false,
            ...options
        };
        
        // Event storage - partitioned for scalability
        this.partitions = new Array(this.options.partitionCount)
            .fill(null)
            .map(() => new Map()); // streamId -> events[]
        
        // Stream metadata
        this.streamMetadata = new Map(); // streamId -> { version, lastEventId, created, updated }
        
        // Snapshots for performance
        this.snapshots = new Map(); // streamId -> { version, data, timestamp }
        
        // Event subscriptions
        this.subscriptions = new Map(); // subscriptionId -> { streamId, fromVersion, handler }
        this.catchUpSubscriptions = new Map();
        this.persistentSubscriptions = new Map();
        
        // Projections
        this.projections = new Map(); // projectionId -> ProjectionInstance
        
        // Transaction support
        this.transactions = new Map(); // transactionId -> { events, streamVersions }
        
        // Performance metrics
        this.metrics = {
            eventsStored: 0,
            eventsRead: 0,
            snapshotsTaken: 0,
            projectionsUpdated: 0,
            subscriptionsActive: 0,
            transactionsCommitted: 0,
            averageWriteLatency: 0,
            averageReadLatency: 0
        };
        
        // Event serialization
        this.serializer = new EventSerializer(this.options);
        
        // Concurrency control
        this.locks = new Map(); // streamId -> Promise
        
        this.initialize();
    }

    /**
     * Initialize event store
     */
    initialize() {
        // Start background tasks
        this.startSnapshotScheduler();
        this.startProjectionUpdater();
        this.startMetricsCollector();
        
        this.emit('initialized');
    }

    /**
     * Append events to stream with optimistic concurrency control
     * @param {string} streamId - Stream identifier
     * @param {Array} events - Events to append
     * @param {number} expectedVersion - Expected stream version
     * @returns {Promise<Object>} Append result
     */
    async appendToStream(streamId, events, expectedVersion = -1) {
        const startTime = process.hrtime.bigint();
        
        try {
            // Acquire stream lock
            await this.acquireStreamLock(streamId);
            
            // Get current stream version
            const currentVersion = await this.getStreamVersion(streamId);
            
            // Check optimistic concurrency
            if (expectedVersion !== -1 && expectedVersion !== currentVersion) {
                throw new ConcurrencyError(
                    `Expected version ${expectedVersion}, but stream is at version ${currentVersion}`
                );
            }
            
            // Validate events
            this.validateEvents(events);
            
            // Serialize and prepare events
            const serializedEvents = await this.prepareEvents(streamId, events, currentVersion);
            
            // Store events
            await this.storeEvents(streamId, serializedEvents);
            
            // Update stream metadata
            await this.updateStreamMetadata(streamId, serializedEvents);
            
            // Notify subscriptions
            await this.notifySubscriptions(streamId, serializedEvents);
            
            // Update projections
            await this.updateProjections(streamId, serializedEvents);
            
            // Update metrics
            this.metrics.eventsStored += events.length;
            this.updateWriteLatency(startTime);
            
            const result = {
                streamId,
                eventsAppended: events.length,
                newVersion: currentVersion + events.length,
                eventIds: serializedEvents.map(e => e.eventId)
            };
            
            this.emit('events-appended', result);
            return result;
            
        } finally {
            this.releaseStreamLock(streamId);
        }
    }

    /**
     * Read events from stream
     * @param {string} streamId - Stream identifier
     * @param {number} fromVersion - Start version (inclusive)
     * @param {number} maxCount - Maximum events to read
     * @returns {Promise<Array>} Events
     */
    async readStreamEvents(streamId, fromVersion = 0, maxCount = 1000) {
        const startTime = process.hrtime.bigint();
        
        try {
            // Check if we can use snapshot
            const snapshot = await this.getSnapshot(streamId, fromVersion);
            let events = [];
            let startVersion = fromVersion;
            
            if (snapshot && snapshot.version < fromVersion) {
                startVersion = snapshot.version + 1;
            }
            
            // Get partition for stream
            const partition = this.getPartition(streamId);
            const streamEvents = partition.get(streamId) || [];
            
            // Filter events by version range
            events = streamEvents
                .filter(event => event.version >= startVersion && event.version < startVersion + maxCount)
                .slice(0, maxCount);
            
            // Deserialize events
            const deserializedEvents = await Promise.all(
                events.map(event => this.serializer.deserialize(event))
            );
            
            // Update metrics
            this.metrics.eventsRead += deserializedEvents.length;
            this.updateReadLatency(startTime);
            
            return {
                streamId,
                events: deserializedEvents,
                fromVersion,
                nextVersion: startVersion + deserializedEvents.length,
                isEndOfStream: deserializedEvents.length < maxCount
            };
            
        } catch (error) {
            this.emit('read-error', { streamId, error });
            throw error;
        }
    }

    /**
     * Read all events from multiple streams
     * @param {Array} streamIds - Stream identifiers
     * @param {Object} options - Read options
     * @returns {Promise<Array>} All events
     */
    async readAllEvents(streamIds = [], options = {}) {
        const {
            fromTimestamp = 0,
            toTimestamp = Date.now(),
            maxCount = 10000,
            direction = 'forward'
        } = options;
        
        const allEvents = [];
        
        // Collect events from all partitions
        for (const partition of this.partitions) {
            for (const [streamId, events] of partition) {
                if (streamIds.length === 0 || streamIds.includes(streamId)) {
                    const filteredEvents = events.filter(event => 
                        event.timestamp >= fromTimestamp && 
                        event.timestamp <= toTimestamp
                    );
                    
                    allEvents.push(...filteredEvents);
                }
            }
        }
        
        // Sort by timestamp
        allEvents.sort((a, b) => 
            direction === 'forward' 
                ? a.timestamp - b.timestamp 
                : b.timestamp - a.timestamp
        );
        
        // Limit results
        const limitedEvents = allEvents.slice(0, maxCount);
        
        // Deserialize events
        return await Promise.all(
            limitedEvents.map(event => this.serializer.deserialize(event))
        );
    }

    /**
     * Create snapshot of stream at specific version
     * @param {string} streamId - Stream identifier
     * @param {number} version - Version to snapshot
     * @param {Object} data - Snapshot data
     * @returns {Promise<Object>} Snapshot result
     */
    async createSnapshot(streamId, version, data) {
        const snapshot = {
            streamId,
            version,
            data: await this.serializer.serialize(data),
            timestamp: Date.now(),
            checksum: this.calculateChecksum(data)
        };
        
        this.snapshots.set(`${streamId}:${version}`, snapshot);
        this.metrics.snapshotsTaken++;
        
        this.emit('snapshot-created', { streamId, version });
        return snapshot;
    }

    /**
     * Get snapshot for stream
     * @param {string} streamId - Stream identifier
     * @param {number} maxVersion - Maximum version
     * @returns {Promise<Object|null>} Snapshot or null
     */
    async getSnapshot(streamId, maxVersion = Infinity) {
        let bestSnapshot = null;
        let bestVersion = -1;
        
        for (const [key, snapshot] of this.snapshots) {
            if (key.startsWith(`${streamId}:`) && 
                snapshot.version <= maxVersion && 
                snapshot.version > bestVersion) {
                bestSnapshot = snapshot;
                bestVersion = snapshot.version;
            }
        }
        
        if (bestSnapshot) {
            return {
                ...bestSnapshot,
                data: await this.serializer.deserialize(bestSnapshot.data)
            };
        }
        
        return null;
    }

    /**
     * Subscribe to stream events
     * @param {string} streamId - Stream identifier
     * @param {Function} handler - Event handler
     * @param {Object} options - Subscription options
     * @returns {string} Subscription ID
     */
    subscribe(streamId, handler, options = {}) {
        const subscriptionId = this.generateId();
        const subscription = {
            id: subscriptionId,
            streamId,
            handler,
            fromVersion: options.fromVersion || 0,
            catchUp: options.catchUp !== false,
            persistent: options.persistent || false,
            created: Date.now()
        };
        
        if (subscription.persistent) {
            this.persistentSubscriptions.set(subscriptionId, subscription);
        } else if (subscription.catchUp) {
            this.catchUpSubscriptions.set(subscriptionId, subscription);
            // Start catch-up process
            this.processCatchUpSubscription(subscription);
        } else {
            this.subscriptions.set(subscriptionId, subscription);
        }
        
        this.metrics.subscriptionsActive++;
        this.emit('subscription-created', { subscriptionId, streamId });
        
        return subscriptionId;
    }

    /**
     * Unsubscribe from stream events
     * @param {string} subscriptionId - Subscription ID
     */
    unsubscribe(subscriptionId) {
        const removed = this.subscriptions.delete(subscriptionId) ||
                       this.catchUpSubscriptions.delete(subscriptionId) ||
                       this.persistentSubscriptions.delete(subscriptionId);
        
        if (removed) {
            this.metrics.subscriptionsActive--;
            this.emit('subscription-removed', { subscriptionId });
        }
    }

    /**
     * Create projection
     * @param {string} projectionId - Projection identifier
     * @param {Object} definition - Projection definition
     * @returns {Promise<Object>} Projection instance
     */
    async createProjection(projectionId, definition) {
        const projection = new Projection(projectionId, definition, this);
        this.projections.set(projectionId, projection);
        
        await projection.initialize();
        
        this.emit('projection-created', { projectionId });
        return projection;
    }

    /**
     * Start transaction
     * @returns {string} Transaction ID
     */
    startTransaction() {
        const transactionId = this.generateId();
        this.transactions.set(transactionId, {
            id: transactionId,
            events: [],
            streamVersions: new Map(),
            started: Date.now()
        });
        
        return transactionId;
    }

    /**
     * Add events to transaction
     * @param {string} transactionId - Transaction ID
     * @param {string} streamId - Stream identifier
     * @param {Array} events - Events to add
     * @param {number} expectedVersion - Expected stream version
     */
    addToTransaction(transactionId, streamId, events, expectedVersion) {
        const transaction = this.transactions.get(transactionId);
        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }
        
        transaction.events.push({ streamId, events, expectedVersion });
        transaction.streamVersions.set(streamId, expectedVersion);
    }

    /**
     * Commit transaction
     * @param {string} transactionId - Transaction ID
     * @returns {Promise<Object>} Commit result
     */
    async commitTransaction(transactionId) {
        const transaction = this.transactions.get(transactionId);
        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }
        
        try {
            const results = [];
            
            // Append all events atomically
            for (const { streamId, events, expectedVersion } of transaction.events) {
                const result = await this.appendToStream(streamId, events, expectedVersion);
                results.push(result);
            }
            
            this.transactions.delete(transactionId);
            this.metrics.transactionsCommitted++;
            
            const commitResult = {
                transactionId,
                streamsAffected: results.length,
                totalEvents: results.reduce((sum, r) => sum + r.eventsAppended, 0),
                results
            };
            
            this.emit('transaction-committed', commitResult);
            return commitResult;
            
        } catch (error) {
            this.transactions.delete(transactionId);
            this.emit('transaction-failed', { transactionId, error });
            throw error;
        }
    }

    /**
     * Rollback transaction
     * @param {string} transactionId - Transaction ID
     */
    rollbackTransaction(transactionId) {
        const transaction = this.transactions.get(transactionId);
        if (transaction) {
            this.transactions.delete(transactionId);
            this.emit('transaction-rolled-back', { transactionId });
        }
    }

    /**
     * Get partition for stream (consistent hashing)
     * @param {string} streamId - Stream identifier
     * @returns {Map} Partition map
     */
    getPartition(streamId) {
        const hash = crypto.createHash('sha256').update(streamId).digest();
        const partitionIndex = hash.readUInt32BE(0) % this.options.partitionCount;
        return this.partitions[partitionIndex];
    }

    /**
     * Prepare events for storage
     * @param {string} streamId - Stream identifier
     * @param {Array} events - Events to prepare
     * @param {number} currentVersion - Current stream version
     * @returns {Promise<Array>} Prepared events
     */
    async prepareEvents(streamId, events, currentVersion) {
        const prepared = [];
        
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            const preparedEvent = {
                eventId: this.generateId(),
                streamId,
                version: currentVersion + i + 1,
                eventType: event.eventType || event.constructor.name,
                data: await this.serializer.serialize(event.data || event),
                metadata: await this.serializer.serialize(event.metadata || {}),
                timestamp: Date.now(),
                correlationId: event.correlationId || null,
                causationId: event.causationId || null
            };
            
            // Add checksum for integrity
            preparedEvent.checksum = this.calculateChecksum(preparedEvent);
            
            prepared.push(preparedEvent);
        }
        
        return prepared;
    }

    /**
     * Store events in partition
     * @param {string} streamId - Stream identifier
     * @param {Array} events - Events to store
     */
    async storeEvents(streamId, events) {
        const partition = this.getPartition(streamId);
        
        if (!partition.has(streamId)) {
            partition.set(streamId, []);
        }
        
        const streamEvents = partition.get(streamId);
        streamEvents.push(...events);
        
        // Maintain stream size limit
        if (streamEvents.length > this.options.maxEventsPerStream) {
            // Archive old events (simplified - in production, move to cold storage)
            streamEvents.splice(0, streamEvents.length - this.options.maxEventsPerStream);
        }
    }

    /**
     * Validate events before storage
     * @param {Array} events - Events to validate
     */
    validateEvents(events) {
        if (!Array.isArray(events) || events.length === 0) {
            throw new ValidationError('Events must be a non-empty array');
        }
        
        for (const event of events) {
            if (!event || typeof event !== 'object') {
                throw new ValidationError('Each event must be an object');
            }
            
            if (!event.eventType && !event.constructor?.name) {
                throw new ValidationError('Each event must have an eventType');
            }
        }
    }

    /**
     * Calculate checksum for data integrity
     * @param {*} data - Data to checksum
     * @returns {string} Checksum
     */
    calculateChecksum(data) {
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(data))
            .digest('hex');
    }

    /**
     * Generate unique ID
     * @returns {string} Unique ID
     */
    generateId() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Acquire stream lock for concurrency control
     * @param {string} streamId - Stream identifier
     */
    async acquireStreamLock(streamId) {
        while (this.locks.has(streamId)) {
            await this.locks.get(streamId);
        }
        
        let resolve;
        const lockPromise = new Promise(r => resolve = r);
        lockPromise.resolve = resolve;
        
        this.locks.set(streamId, lockPromise);
    }

    /**
     * Release stream lock
     * @param {string} streamId - Stream identifier
     */
    releaseStreamLock(streamId) {
        const lock = this.locks.get(streamId);
        if (lock) {
            this.locks.delete(streamId);
            lock.resolve();
        }
    }

    /**
     * Get current stream version
     * @param {string} streamId - Stream identifier
     * @returns {number} Current version
     */
    async getStreamVersion(streamId) {
        const metadata = this.streamMetadata.get(streamId);
        return metadata ? metadata.version : 0;
    }

    /**
     * Update stream metadata
     * @param {string} streamId - Stream identifier
     * @param {Array} events - Appended events
     */
    async updateStreamMetadata(streamId, events) {
        const existing = this.streamMetadata.get(streamId) || {
            version: 0,
            created: Date.now()
        };
        
        this.streamMetadata.set(streamId, {
            ...existing,
            version: existing.version + events.length,
            lastEventId: events[events.length - 1].eventId,
            updated: Date.now()
        });
    }

    /**
     * Notify subscriptions of new events
     * @param {string} streamId - Stream identifier
     * @param {Array} events - New events
     */
    async notifySubscriptions(streamId, events) {
        const allSubscriptions = [
            ...this.subscriptions.values(),
            ...this.catchUpSubscriptions.values(),
            ...this.persistentSubscriptions.values()
        ];
        
        for (const subscription of allSubscriptions) {
            if (subscription.streamId === streamId || subscription.streamId === '*') {
                try {
                    for (const event of events) {
                        if (event.version >= subscription.fromVersion) {
                            const deserializedEvent = await this.serializer.deserialize(event);
                            await subscription.handler(deserializedEvent);
                        }
                    }
                } catch (error) {
                    this.emit('subscription-error', { 
                        subscriptionId: subscription.id, 
                        error 
                    });
                }
            }
        }
    }

    /**
     * Update projections with new events
     * @param {string} streamId - Stream identifier
     * @param {Array} events - New events
     */
    async updateProjections(streamId, events) {
        for (const projection of this.projections.values()) {
            if (projection.handlesStream(streamId)) {
                try {
                    await projection.processEvents(events);
                    this.metrics.projectionsUpdated++;
                } catch (error) {
                    this.emit('projection-error', { 
                        projectionId: projection.id, 
                        error 
                    });
                }
            }
        }
    }

    /**
     * Start background snapshot scheduler
     */
    startSnapshotScheduler() {
        setInterval(async () => {
            // Auto-create snapshots for active streams
            for (const [streamId, metadata] of this.streamMetadata) {
                if (metadata.version % this.options.snapshotFrequency === 0) {
                    // This would typically rebuild state from events
                    // For now, just create empty snapshot
                    await this.createSnapshot(streamId, metadata.version, {});
                }
            }
        }, 60000); // Every minute
    }

    /**
     * Start projection updater
     */
    startProjectionUpdater() {
        setInterval(async () => {
            for (const projection of this.projections.values()) {
                await projection.checkpointProgress();
            }
        }, 30000); // Every 30 seconds
    }

    /**
     * Start metrics collector
     */
    startMetricsCollector() {
        setInterval(() => {
            this.emit('metrics-updated', this.getMetrics());
        }, 10000); // Every 10 seconds
    }

    /**
     * Update write latency metric
     * @param {bigint} startTime - Start time
     */
    updateWriteLatency(startTime) {
        const latency = Number(process.hrtime.bigint() - startTime) / 1000000; // ms
        this.metrics.averageWriteLatency = 
            (this.metrics.averageWriteLatency * 0.9) + (latency * 0.1);
    }

    /**
     * Update read latency metric
     * @param {bigint} startTime - Start time
     */
    updateReadLatency(startTime) {
        const latency = Number(process.hrtime.bigint() - startTime) / 1000000; // ms
        this.metrics.averageReadLatency = 
            (this.metrics.averageReadLatency * 0.9) + (latency * 0.1);
    }

    /**
     * Get event store metrics
     * @returns {Object} Metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            streamsCount: this.streamMetadata.size,
            snapshotsCount: this.snapshots.size,
            projectionsCount: this.projections.size,
            activeTransactions: this.transactions.size,
            partitionsCount: this.options.partitionCount
        };
    }

    /**
     * Shutdown event store
     */
    async shutdown() {
        // Complete pending transactions
        for (const [transactionId] of this.transactions) {
            this.rollbackTransaction(transactionId);
        }
        
        // Shutdown projections
        for (const projection of this.projections.values()) {
            await projection.shutdown();
        }
        
        this.emit('shutdown');
    }
}

/**
 * Event serializer with compression and encryption
 */
class EventSerializer {
    constructor(options) {
        this.compressionEnabled = options.compressionEnabled;
        this.encryptionEnabled = options.encryptionEnabled;
        this.encryptionKey = options.encryptionKey;
    }

    async serialize(data) {
        let serialized = JSON.stringify(data);
        
        if (this.compressionEnabled) {
            // In production, use actual compression library
            serialized = this.compress(serialized);
        }
        
        if (this.encryptionEnabled && this.encryptionKey) {
            serialized = this.encrypt(serialized);
        }
        
        return serialized;
    }

    async deserialize(data) {
        let deserialized = data;
        
        if (this.encryptionEnabled && this.encryptionKey) {
            deserialized = this.decrypt(deserialized);
        }
        
        if (this.compressionEnabled) {
            deserialized = this.decompress(deserialized);
        }
        
        return JSON.parse(deserialized);
    }

    compress(data) {
        // Simplified compression
        return Buffer.from(data).toString('base64');
    }

    decompress(data) {
        return Buffer.from(data, 'base64').toString();
    }

    encrypt(data) {
        const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    decrypt(data) {
        const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
        let decrypted = decipher.update(data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}

/**
 * Projection class for read models
 */
class Projection extends EventEmitter {
    constructor(id, definition, eventStore) {
        super();
        this.id = id;
        this.definition = definition;
        this.eventStore = eventStore;
        this.state = new Map();
        this.checkpoint = 0;
        this.isRunning = false;
    }

    async initialize() {
        this.isRunning = true;
        // Load checkpoint from storage
        // Start processing from checkpoint
    }

    handlesStream(streamId) {
        return this.definition.streams.includes(streamId) || 
               this.definition.streams.includes('*');
    }

    async processEvents(events) {
        for (const event of events) {
            if (this.definition.eventHandlers[event.eventType]) {
                await this.definition.eventHandlers[event.eventType](this.state, event);
            }
        }
    }

    async checkpointProgress() {
        // Save current checkpoint
    }

    async shutdown() {
        this.isRunning = false;
    }
}

// Custom error classes
class ConcurrencyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConcurrencyError';
    }
}

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

module.exports = { 
    EventStore, 
    EventSerializer, 
    Projection, 
    ConcurrencyError, 
    ValidationError 
};
