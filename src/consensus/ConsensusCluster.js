/**
 * Distributed Consensus Cluster Manager
 * Manages Raft cluster with dynamic membership, leader discovery, and fault tolerance
 * Features: Auto-discovery, health monitoring, configuration changes
 */
const { EventEmitter } = require('events');
const { RaftNode } = require('./RaftNode.js');

class ConsensusCluster extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.clusterId = options.clusterId || 'default';
        this.nodeId = options.nodeId || this.generateNodeId();
        this.initialPeers = options.peers || [];
        this.autoDiscovery = options.autoDiscovery !== false;
        this.healthCheckInterval = options.healthCheckInterval || 5000;
        
        // Cluster state
        this.nodes = new Map(); // nodeId -> RaftNode
        this.currentLeader = null;
        this.clusterSize = 0;
        this.healthyNodes = new Set();
        
        // Configuration management
        this.pendingConfigChanges = new Map();
        this.configChangeTimeout = 30000; // 30 seconds
        
        // Service discovery
        this.discoveryService = options.discoveryService || new MockDiscoveryService();
        this.discoveryInterval = null;
        
        // Health monitoring
        this.healthMonitor = {
            checks: new Map(),
            failures: new Map(),
            threshold: 3 // Failed checks before marking unhealthy
        };
        
        // Cluster metrics
        this.metrics = {
            leaderElections: 0,
            configChanges: 0,
            nodeJoins: 0,
            nodeLeaves: 0,
            partitionEvents: 0,
            consensusLatency: 0
        };
        
        // State machine for distributed operations
        this.stateMachine = new Map();
        
        this.initialize();
    }

    /**
     * Initialize consensus cluster
     */
    async initialize() {
        try {
            // Register with discovery service
            if (this.autoDiscovery) {
                await this.registerWithDiscovery();
                this.startDiscovery();
            }
            
            // Create local Raft node
            await this.createLocalNode();
            
            // Start health monitoring
            this.startHealthMonitoring();
            
            // Setup cluster event handlers
            this.setupEventHandlers();
            
            this.emit('initialized', { 
                clusterId: this.clusterId, 
                nodeId: this.nodeId 
            });
            
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Create local Raft node
     */
    async createLocalNode() {
        const raftNode = new RaftNode(this.nodeId, this.initialPeers, {
            network: new ClusterNetwork(this),
            storage: new ClusterStorage(this.nodeId)
        });
        
        this.nodes.set(this.nodeId, raftNode);
        this.healthyNodes.add(this.nodeId);
        this.clusterSize = this.initialPeers.length + 1;
        
        // Setup Raft event handlers
        raftNode.on('state-change', (event) => {
            this.handleStateChange(this.nodeId, event);
        });
        
        raftNode.on('leader-elected', (event) => {
            this.handleLeaderElection(event);
        });
        
        raftNode.on('entry-applied', (event) => {
            this.handleEntryApplied(event);
        });
        
        raftNode.on('byzantine-detected', (event) => {
            this.handleByzantineDetection(event);
        });
        
        await raftNode.initialize();
    }

    /**
     * Register with service discovery
     */
    async registerWithDiscovery() {
        await this.discoveryService.register({
            nodeId: this.nodeId,
            clusterId: this.clusterId,
            address: process.env.NODE_ADDRESS || 'localhost',
            port: process.env.NODE_PORT || 8080,
            metadata: {
                version: '1.0.0',
                capabilities: ['raft', 'consensus', 'replication']
            }
        });
    }

    /**
     * Start service discovery
     */
    startDiscovery() {
        this.discoveryInterval = setInterval(async () => {
            try {
                const peers = await this.discoveryService.discover(this.clusterId);
                await this.updateClusterMembership(peers);
            } catch (error) {
                console.warn('Discovery failed:', error);
            }
        }, 10000); // Every 10 seconds
    }

    /**
     * Update cluster membership based on discovery
     * @param {Array} discoveredPeers - Discovered peer nodes
     */
    async updateClusterMembership(discoveredPeers) {
        const currentPeers = new Set(this.nodes.keys());
        const newPeers = new Set(discoveredPeers.map(peer => peer.nodeId));
        
        // Add new nodes
        for (const peer of discoveredPeers) {
            if (!currentPeers.has(peer.nodeId) && peer.nodeId !== this.nodeId) {
                await this.addNode(peer);
            }
        }
        
        // Remove departed nodes
        for (const nodeId of currentPeers) {
            if (!newPeers.has(nodeId) && nodeId !== this.nodeId) {
                await this.removeNode(nodeId);
            }
        }
    }

    /**
     * Add node to cluster
     * @param {Object} nodeInfo - Node information
     */
    async addNode(nodeInfo) {
        try {
            // Propose configuration change through Raft
            const configChange = {
                type: 'addNode',
                nodeId: nodeInfo.nodeId,
                address: nodeInfo.address,
                port: nodeInfo.port,
                timestamp: Date.now()
            };
            
            await this.proposeConfigChange(configChange);
            this.metrics.nodeJoins++;
            
        } catch (error) {
            console.error('Failed to add node:', error);
        }
    }

    /**
     * Remove node from cluster
     * @param {string} nodeId - Node ID to remove
     */
    async removeNode(nodeId) {
        try {
            // Propose configuration change through Raft
            const configChange = {
                type: 'removeNode',
                nodeId,
                timestamp: Date.now()
            };
            
            await this.proposeConfigChange(configChange);
            this.metrics.nodeLeaves++;
            
        } catch (error) {
            console.error('Failed to remove node:', error);
        }
    }

    /**
     * Propose configuration change through Raft consensus
     * @param {Object} configChange - Configuration change
     */
    async proposeConfigChange(configChange) {
        const localNode = this.nodes.get(this.nodeId);
        if (!localNode || localNode.state !== 'leader') {
            throw new Error('Only leader can propose configuration changes');
        }
        
        const changeId = this.generateChangeId();
        configChange.changeId = changeId;
        
        // Store pending change
        this.pendingConfigChanges.set(changeId, {
            change: configChange,
            timestamp: Date.now(),
            timeout: setTimeout(() => {
                this.pendingConfigChanges.delete(changeId);
            }, this.configChangeTimeout)
        });
        
        // Submit through Raft
        await localNode.submitCommand({
            type: 'configChange',
            data: configChange
        });
        
        this.metrics.configChanges++;
    }

    /**
     * Handle Raft state change
     * @param {string} nodeId - Node ID
     * @param {Object} event - State change event
     */
    handleStateChange(nodeId, event) {
        if (event.state === 'leader') {
            this.currentLeader = nodeId;
        } else if (this.currentLeader === nodeId) {
            this.currentLeader = null;
        }
        
        this.emit('node-state-change', { nodeId, ...event });
    }

    /**
     * Handle leader election
     * @param {Object} event - Leader election event
     */
    handleLeaderElection(event) {
        this.currentLeader = event.nodeId;
        this.metrics.leaderElections++;
        
        this.emit('leader-elected', event);
    }

    /**
     * Handle applied log entry
     * @param {Object} event - Entry applied event
     */
    async handleEntryApplied(event) {
        const { entry } = event;
        
        if (entry.command.type === 'configChange') {
            await this.applyConfigChange(entry.command.data);
        } else {
            // Apply to state machine
            await this.applyToStateMachine(entry);
        }
        
        this.emit('entry-applied', event);
    }

    /**
     * Apply configuration change
     * @param {Object} configChange - Configuration change to apply
     */
    async applyConfigChange(configChange) {
        const { changeId, type, nodeId } = configChange;
        
        // Clear pending change
        const pending = this.pendingConfigChanges.get(changeId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingConfigChanges.delete(changeId);
        }
        
        switch (type) {
            case 'addNode':
                this.healthyNodes.add(nodeId);
                this.clusterSize++;
                break;
                
            case 'removeNode':
                this.healthyNodes.delete(nodeId);
                this.nodes.delete(nodeId);
                this.clusterSize--;
                break;
        }
        
        // Update all Raft nodes with new peer set
        const peerSet = Array.from(this.healthyNodes).filter(id => id !== this.nodeId);
        for (const [id, node] of this.nodes) {
            node.peers = new Set(peerSet);
        }
        
        this.emit('config-change-applied', configChange);
    }

    /**
     * Apply command to distributed state machine
     * @param {Object} entry - Log entry
     */
    async applyToStateMachine(entry) {
        const { command } = entry;
        
        switch (command.type) {
            case 'set':
                this.stateMachine.set(command.key, command.value);
                break;
                
            case 'delete':
                this.stateMachine.delete(command.key);
                break;
                
            case 'increment':
                const current = this.stateMachine.get(command.key) || 0;
                this.stateMachine.set(command.key, current + (command.amount || 1));
                break;
                
            default:
                console.warn('Unknown command type:', command.type);
        }
    }

    /**
     * Handle Byzantine node detection
     * @param {Object} event - Byzantine detection event
     */
    handleByzantineDetection(event) {
        const { nodeId } = event;
        
        // Remove Byzantine node from healthy set
        this.healthyNodes.delete(nodeId);
        
        // Propose removal through consensus
        this.removeNode(nodeId).catch(error => {
            console.error('Failed to remove Byzantine node:', error);
        });
        
        this.emit('byzantine-detected', event);
    }

    /**
     * Setup cluster event handlers
     */
    setupEventHandlers() {
        // Handle process signals for graceful shutdown
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
        
        // Handle uncaught errors
        process.on('uncaughtException', (error) => {
            console.error('Uncaught exception in consensus cluster:', error);
            this.emit('error', error);
        });
    }

    /**
     * Start health monitoring
     */
    startHealthMonitoring() {
        setInterval(async () => {
            await this.performHealthChecks();
        }, this.healthCheckInterval);
    }

    /**
     * Perform health checks on all nodes
     */
    async performHealthChecks() {
        for (const nodeId of this.healthyNodes) {
            try {
                const isHealthy = await this.checkNodeHealth(nodeId);
                
                if (!isHealthy) {
                    this.recordHealthFailure(nodeId);
                } else {
                    this.recordHealthSuccess(nodeId);
                }
            } catch (error) {
                this.recordHealthFailure(nodeId);
            }
        }
    }

    /**
     * Check individual node health
     * @param {string} nodeId - Node ID to check
     * @returns {boolean} Is node healthy
     */
    async checkNodeHealth(nodeId) {
        if (nodeId === this.nodeId) {
            // Self health check
            return this.nodes.has(nodeId);
        }
        
        // For remote nodes, this would ping the actual node
        // For now, simulate health check
        return Math.random() > 0.1; // 90% healthy
    }

    /**
     * Record health check failure
     * @param {string} nodeId - Node ID
     */
    recordHealthFailure(nodeId) {
        const failures = this.healthMonitor.failures.get(nodeId) || 0;
        this.healthMonitor.failures.set(nodeId, failures + 1);
        
        if (failures + 1 >= this.healthMonitor.threshold) {
            this.markNodeUnhealthy(nodeId);
        }
    }

    /**
     * Record health check success
     * @param {string} nodeId - Node ID
     */
    recordHealthSuccess(nodeId) {
        this.healthMonitor.failures.delete(nodeId);
    }

    /**
     * Mark node as unhealthy
     * @param {string} nodeId - Node ID
     */
    markNodeUnhealthy(nodeId) {
        if (this.healthyNodes.has(nodeId)) {
            this.healthyNodes.delete(nodeId);
            this.emit('node-unhealthy', { nodeId, timestamp: Date.now() });
            
            // Propose removal if not self
            if (nodeId !== this.nodeId) {
                this.removeNode(nodeId).catch(console.error);
            }
        }
    }

    /**
     * Submit command to cluster
     * @param {Object} command - Command to submit
     * @returns {Promise<*>} Command result
     */
    async submitCommand(command) {
        const localNode = this.nodes.get(this.nodeId);
        
        if (!localNode) {
            throw new Error('Local node not available');
        }
        
        if (localNode.state !== 'leader') {
            if (this.currentLeader) {
                throw new Error(`Not leader. Current leader: ${this.currentLeader}`);
            } else {
                throw new Error('No leader available');
            }
        }
        
        const startTime = Date.now();
        await localNode.submitCommand(command);
        
        // Update consensus latency metric
        this.metrics.consensusLatency = Date.now() - startTime;
        
        return true;
    }

    /**
     * Get value from distributed state machine
     * @param {string} key - Key to retrieve
     * @returns {*} Value
     */
    get(key) {
        return this.stateMachine.get(key);
    }

    /**
     * Set value in distributed state machine
     * @param {string} key - Key to set
     * @param {*} value - Value to set
     * @returns {Promise<boolean>} Success status
     */
    async set(key, value) {
        return await this.submitCommand({
            type: 'set',
            key,
            value,
            timestamp: Date.now()
        });
    }

    /**
     * Delete key from distributed state machine
     * @param {string} key - Key to delete
     * @returns {Promise<boolean>} Success status
     */
    async delete(key) {
        return await this.submitCommand({
            type: 'delete',
            key,
            timestamp: Date.now()
        });
    }

    /**
     * Generate unique node ID
     * @returns {string} Node ID
     */
    generateNodeId() {
        const crypto = require('crypto');
        return `node_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Generate unique change ID
     * @returns {string} Change ID
     */
    generateChangeId() {
        const crypto = require('crypto');
        return `change_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    /**
     * Get cluster status
     * @returns {Object} Cluster status
     */
    getStatus() {
        return {
            clusterId: this.clusterId,
            nodeId: this.nodeId,
            currentLeader: this.currentLeader,
            clusterSize: this.clusterSize,
            healthyNodes: Array.from(this.healthyNodes),
            stateMachineSize: this.stateMachine.size,
            metrics: this.metrics,
            pendingConfigChanges: this.pendingConfigChanges.size
        };
    }

    /**
     * Shutdown consensus cluster
     */
    async shutdown() {
        console.log('Shutting down consensus cluster...');
        
        // Stop discovery
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
        }
        
        // Deregister from discovery service
        if (this.autoDiscovery) {
            await this.discoveryService.deregister(this.nodeId);
        }
        
        // Shutdown all Raft nodes
        for (const [nodeId, node] of this.nodes) {
            await node.shutdown();
        }
        
        this.nodes.clear();
        this.healthyNodes.clear();
        this.stateMachine.clear();
        
        this.emit('shutdown', { clusterId: this.clusterId });
    }
}

/**
 * Cluster network adapter
 */
class ClusterNetwork extends EventEmitter {
    constructor(cluster) {
        super();
        this.cluster = cluster;
    }

    async send(to, message) {
        // In production, this would send over actual network
        // For now, simulate local delivery
        setTimeout(() => {
            this.emit('message', message);
        }, Math.random() * 10); // Random latency 0-10ms
    }
}

/**
 * Cluster storage adapter
 */
class ClusterStorage {
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.data = new Map();
    }

    async save(nodeId, state) {
        this.data.set(`${nodeId}_state`, JSON.stringify(state));
    }

    async load(nodeId) {
        const data = this.data.get(`${nodeId}_state`);
        return data ? JSON.parse(data) : null;
    }
}

/**
 * Mock service discovery
 */
class MockDiscoveryService {
    constructor() {
        this.registry = new Map();
    }

    async register(nodeInfo) {
        this.registry.set(nodeInfo.nodeId, {
            ...nodeInfo,
            registeredAt: Date.now(),
            lastSeen: Date.now()
        });
    }

    async deregister(nodeId) {
        this.registry.delete(nodeId);
    }

    async discover(clusterId) {
        const nodes = [];
        for (const [nodeId, info] of this.registry) {
            if (info.clusterId === clusterId) {
                nodes.push(info);
            }
        }
        return nodes;
    }
}

module.exports = { ConsensusCluster, ClusterNetwork, ClusterStorage, MockDiscoveryService };
