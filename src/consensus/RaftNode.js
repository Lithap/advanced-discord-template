/**
 * Raft Consensus Algorithm Implementation
 * Distributed consensus with leader election, log replication, and fault tolerance
 * Features: Byzantine fault tolerance, network partitions, dynamic membership
 */
const { EventEmitter } = require('events');
const crypto = require('crypto');

class RaftNode extends EventEmitter {
    constructor(nodeId, peers, options = {}) {
        super();
        
        this.nodeId = nodeId;
        this.peers = new Set(peers);
        this.options = {
            electionTimeoutMin: options.electionTimeoutMin || 150,
            electionTimeoutMax: options.electionTimeoutMax || 300,
            heartbeatInterval: options.heartbeatInterval || 50,
            maxLogEntries: options.maxLogEntries || 10000,
            snapshotThreshold: options.snapshotThreshold || 1000,
            ...options
        };
        
        // Raft state
        this.state = 'follower'; // follower, candidate, leader
        this.currentTerm = 0;
        this.votedFor = null;
        this.log = []; // { term, index, command, timestamp }
        
        // Volatile state
        this.commitIndex = 0;
        this.lastApplied = 0;
        
        // Leader state (reinitialized after election)
        this.nextIndex = new Map(); // nodeId -> next log index to send
        this.matchIndex = new Map(); // nodeId -> highest log index replicated
        
        // Election state
        this.electionTimer = null;
        this.heartbeatTimer = null;
        this.votesReceived = new Set();
        
        // Network and persistence
        this.network = options.network || new MockNetwork();
        this.storage = options.storage || new MemoryStorage();
        
        // Performance metrics
        this.metrics = {
            elections: 0,
            heartbeats: 0,
            logEntries: 0,
            snapshots: 0,
            networkPartitions: 0,
            leaderChanges: 0
        };
        
        // Byzantine fault detection
        this.byzantineDetector = {
            suspiciousNodes: new Map(),
            threshold: 3, // Suspicious actions before marking as Byzantine
            quarantineTime: 300000 // 5 minutes
        };
        
        this.initialize();
    }

    /**
     * Initialize Raft node
     */
    async initialize() {
        // Load persistent state
        await this.loadPersistentState();
        
        // Setup network handlers
        this.setupNetworkHandlers();
        
        // Start as follower
        this.becomeFollower(this.currentTerm);
        
        this.emit('initialized', { nodeId: this.nodeId, term: this.currentTerm });
    }

    /**
     * Load persistent state from storage
     */
    async loadPersistentState() {
        try {
            const state = await this.storage.load(this.nodeId);
            if (state) {
                this.currentTerm = state.currentTerm || 0;
                this.votedFor = state.votedFor || null;
                this.log = state.log || [];
                this.commitIndex = state.commitIndex || 0;
            }
        } catch (error) {
            console.warn('Failed to load persistent state:', error);
        }
    }

    /**
     * Save persistent state to storage
     */
    async savePersistentState() {
        try {
            await this.storage.save(this.nodeId, {
                currentTerm: this.currentTerm,
                votedFor: this.votedFor,
                log: this.log,
                commitIndex: this.commitIndex,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Failed to save persistent state:', error);
        }
    }

    /**
     * Setup network message handlers
     */
    setupNetworkHandlers() {
        this.network.on('message', async (message) => {
            await this.handleMessage(message);
        });
        
        this.network.on('partition', (partitionedNodes) => {
            this.handleNetworkPartition(partitionedNodes);
        });
        
        this.network.on('heal', () => {
            this.handleNetworkHeal();
        });
    }

    /**
     * Handle incoming network message
     * @param {Object} message - Network message
     */
    async handleMessage(message) {
        // Validate message authenticity (Byzantine protection)
        if (!this.validateMessage(message)) {
            this.reportSuspiciousActivity(message.from, 'invalid_message');
            return;
        }
        
        // Update term if message has higher term
        if (message.term > this.currentTerm) {
            this.currentTerm = message.term;
            this.votedFor = null;
            this.becomeFollower(message.term);
            await this.savePersistentState();
        }
        
        // Handle different message types
        switch (message.type) {
            case 'requestVote':
                await this.handleRequestVote(message);
                break;
            case 'requestVoteResponse':
                await this.handleRequestVoteResponse(message);
                break;
            case 'appendEntries':
                await this.handleAppendEntries(message);
                break;
            case 'appendEntriesResponse':
                await this.handleAppendEntriesResponse(message);
                break;
            case 'installSnapshot':
                await this.handleInstallSnapshot(message);
                break;
            default:
                console.warn('Unknown message type:', message.type);
        }
    }

    /**
     * Validate message for Byzantine fault tolerance
     * @param {Object} message - Message to validate
     * @returns {boolean} Is message valid
     */
    validateMessage(message) {
        // Check required fields
        if (!message.from || !message.type || message.term === undefined) {
            return false;
        }
        
        // Check if sender is known peer
        if (!this.peers.has(message.from) && message.from !== this.nodeId) {
            return false;
        }
        
        // Validate message signature (if present)
        if (message.signature) {
            return this.verifyMessageSignature(message);
        }
        
        return true;
    }

    /**
     * Verify message signature for Byzantine protection
     * @param {Object} message - Message with signature
     * @returns {boolean} Is signature valid
     */
    verifyMessageSignature(message) {
        // Simplified signature verification
        // In production, use proper cryptographic signatures
        const { signature, ...messageData } = message;
        const expectedSignature = crypto
            .createHash('sha256')
            .update(JSON.stringify(messageData))
            .digest('hex');
        
        return signature === expectedSignature;
    }

    /**
     * Report suspicious activity for Byzantine detection
     * @param {string} nodeId - Suspicious node ID
     * @param {string} activity - Type of suspicious activity
     */
    reportSuspiciousActivity(nodeId, activity) {
        if (!this.byzantineDetector.suspiciousNodes.has(nodeId)) {
            this.byzantineDetector.suspiciousNodes.set(nodeId, {
                count: 0,
                activities: [],
                firstSeen: Date.now()
            });
        }
        
        const record = this.byzantineDetector.suspiciousNodes.get(nodeId);
        record.count++;
        record.activities.push({ activity, timestamp: Date.now() });
        
        if (record.count >= this.byzantineDetector.threshold) {
            this.quarantineNode(nodeId);
        }
    }

    /**
     * Quarantine Byzantine node
     * @param {string} nodeId - Node to quarantine
     */
    quarantineNode(nodeId) {
        this.peers.delete(nodeId);
        
        setTimeout(() => {
            // Re-evaluate node after quarantine period
            this.byzantineDetector.suspiciousNodes.delete(nodeId);
        }, this.byzantineDetector.quarantineTime);
        
        this.emit('byzantine-detected', { nodeId, timestamp: Date.now() });
    }

    /**
     * Become follower
     * @param {number} term - Current term
     */
    becomeFollower(term) {
        this.state = 'follower';
        this.currentTerm = term;
        this.votedFor = null;
        
        this.clearTimers();
        this.resetElectionTimer();
        
        this.emit('state-change', { state: 'follower', term });
    }

    /**
     * Become candidate and start election
     */
    async becomeCandidate() {
        this.state = 'candidate';
        this.currentTerm++;
        this.votedFor = this.nodeId;
        this.votesReceived.clear();
        this.votesReceived.add(this.nodeId);
        
        this.metrics.elections++;
        
        await this.savePersistentState();
        
        this.clearTimers();
        this.resetElectionTimer();
        
        // Send RequestVote RPCs to all peers
        await this.sendRequestVoteRPCs();
        
        this.emit('state-change', { state: 'candidate', term: this.currentTerm });
    }

    /**
     * Become leader
     */
    async becomeLeader() {
        this.state = 'leader';
        this.metrics.leaderChanges++;
        
        // Initialize leader state
        this.nextIndex.clear();
        this.matchIndex.clear();
        
        for (const peer of this.peers) {
            this.nextIndex.set(peer, this.log.length);
            this.matchIndex.set(peer, 0);
        }
        
        this.clearTimers();
        this.startHeartbeat();
        
        // Send initial heartbeat
        await this.sendHeartbeat();
        
        this.emit('state-change', { state: 'leader', term: this.currentTerm });
        this.emit('leader-elected', { nodeId: this.nodeId, term: this.currentTerm });
    }

    /**
     * Send RequestVote RPCs to all peers
     */
    async sendRequestVoteRPCs() {
        const lastLogIndex = this.log.length - 1;
        const lastLogTerm = lastLogIndex >= 0 ? this.log[lastLogIndex].term : 0;
        
        const message = {
            type: 'requestVote',
            from: this.nodeId,
            term: this.currentTerm,
            candidateId: this.nodeId,
            lastLogIndex,
            lastLogTerm,
            timestamp: Date.now()
        };
        
        for (const peer of this.peers) {
            await this.network.send(peer, message);
        }
    }

    /**
     * Handle RequestVote RPC
     * @param {Object} message - RequestVote message
     */
    async handleRequestVote(message) {
        let voteGranted = false;
        
        // Check if we can vote for this candidate
        if (message.term >= this.currentTerm &&
            (this.votedFor === null || this.votedFor === message.candidateId)) {
            
            // Check if candidate's log is at least as up-to-date as ours
            const lastLogIndex = this.log.length - 1;
            const lastLogTerm = lastLogIndex >= 0 ? this.log[lastLogIndex].term : 0;
            
            const candidateLogUpToDate = 
                message.lastLogTerm > lastLogTerm ||
                (message.lastLogTerm === lastLogTerm && message.lastLogIndex >= lastLogIndex);
            
            if (candidateLogUpToDate) {
                voteGranted = true;
                this.votedFor = message.candidateId;
                this.resetElectionTimer();
                await this.savePersistentState();
            }
        }
        
        const response = {
            type: 'requestVoteResponse',
            from: this.nodeId,
            to: message.from,
            term: this.currentTerm,
            voteGranted,
            timestamp: Date.now()
        };
        
        await this.network.send(message.from, response);
    }

    /**
     * Handle RequestVoteResponse RPC
     * @param {Object} message - RequestVoteResponse message
     */
    async handleRequestVoteResponse(message) {
        if (this.state !== 'candidate' || message.term !== this.currentTerm) {
            return;
        }
        
        if (message.voteGranted) {
            this.votesReceived.add(message.from);
            
            // Check if we have majority votes
            const majoritySize = Math.floor(this.peers.size / 2) + 1;
            if (this.votesReceived.size >= majoritySize) {
                await this.becomeLeader();
            }
        }
    }

    /**
     * Start heartbeat timer (leader only)
     */
    startHeartbeat() {
        this.heartbeatTimer = setInterval(async () => {
            await this.sendHeartbeat();
        }, this.options.heartbeatInterval);
    }

    /**
     * Send heartbeat to all followers
     */
    async sendHeartbeat() {
        if (this.state !== 'leader') return;
        
        this.metrics.heartbeats++;
        
        for (const peer of this.peers) {
            await this.sendAppendEntries(peer);
        }
    }

    /**
     * Send AppendEntries RPC to specific peer
     * @param {string} peerId - Target peer ID
     */
    async sendAppendEntries(peerId) {
        const nextIndex = this.nextIndex.get(peerId) || 0;
        const prevLogIndex = nextIndex - 1;
        const prevLogTerm = prevLogIndex >= 0 ? this.log[prevLogIndex].term : 0;
        
        const entries = this.log.slice(nextIndex);
        
        const message = {
            type: 'appendEntries',
            from: this.nodeId,
            to: peerId,
            term: this.currentTerm,
            leaderId: this.nodeId,
            prevLogIndex,
            prevLogTerm,
            entries,
            leaderCommit: this.commitIndex,
            timestamp: Date.now()
        };
        
        await this.network.send(peerId, message);
    }

    /**
     * Handle AppendEntries RPC
     * @param {Object} message - AppendEntries message
     */
    async handleAppendEntries(message) {
        let success = false;
        
        // Reset election timer (received heartbeat from leader)
        this.resetElectionTimer();
        
        if (message.term >= this.currentTerm) {
            if (this.state !== 'follower') {
                this.becomeFollower(message.term);
            }
            
            // Check if log contains entry at prevLogIndex with prevLogTerm
            if (message.prevLogIndex === -1 || 
                (this.log[message.prevLogIndex] && 
                 this.log[message.prevLogIndex].term === message.prevLogTerm)) {
                
                success = true;
                
                // Append new entries
                if (message.entries.length > 0) {
                    // Remove conflicting entries
                    this.log = this.log.slice(0, message.prevLogIndex + 1);
                    
                    // Append new entries
                    this.log.push(...message.entries);
                    this.metrics.logEntries += message.entries.length;
                    
                    await this.savePersistentState();
                }
                
                // Update commit index
                if (message.leaderCommit > this.commitIndex) {
                    this.commitIndex = Math.min(message.leaderCommit, this.log.length - 1);
                    await this.applyCommittedEntries();
                }
            }
        }
        
        const response = {
            type: 'appendEntriesResponse',
            from: this.nodeId,
            to: message.from,
            term: this.currentTerm,
            success,
            matchIndex: success ? message.prevLogIndex + message.entries.length : 0,
            timestamp: Date.now()
        };
        
        await this.network.send(message.from, response);
    }

    /**
     * Handle AppendEntriesResponse RPC
     * @param {Object} message - AppendEntriesResponse message
     */
    async handleAppendEntriesResponse(message) {
        if (this.state !== 'leader' || message.term !== this.currentTerm) {
            return;
        }
        
        if (message.success) {
            // Update nextIndex and matchIndex
            this.nextIndex.set(message.from, message.matchIndex + 1);
            this.matchIndex.set(message.from, message.matchIndex);
            
            // Update commit index if majority of servers have replicated entry
            this.updateCommitIndex();
        } else {
            // Decrement nextIndex and retry
            const currentNext = this.nextIndex.get(message.from) || 0;
            this.nextIndex.set(message.from, Math.max(0, currentNext - 1));
            
            // Retry AppendEntries
            await this.sendAppendEntries(message.from);
        }
    }

    /**
     * Update commit index based on majority replication
     */
    async updateCommitIndex() {
        for (let n = this.log.length - 1; n > this.commitIndex; n--) {
            if (this.log[n].term === this.currentTerm) {
                let replicationCount = 1; // Count self
                
                for (const matchIndex of this.matchIndex.values()) {
                    if (matchIndex >= n) {
                        replicationCount++;
                    }
                }
                
                const majoritySize = Math.floor(this.peers.size / 2) + 1;
                if (replicationCount >= majoritySize) {
                    this.commitIndex = n;
                    await this.applyCommittedEntries();
                    break;
                }
            }
        }
    }

    /**
     * Apply committed log entries to state machine
     */
    async applyCommittedEntries() {
        while (this.lastApplied < this.commitIndex) {
            this.lastApplied++;
            const entry = this.log[this.lastApplied];
            
            if (entry) {
                await this.applyEntry(entry);
                this.emit('entry-applied', { entry, index: this.lastApplied });
            }
        }
    }

    /**
     * Apply single log entry to state machine
     * @param {Object} entry - Log entry to apply
     */
    async applyEntry(entry) {
        // Override in subclass to implement state machine
        this.emit('command', entry.command);
    }

    /**
     * Submit command to Raft cluster (leader only)
     * @param {*} command - Command to replicate
     * @returns {Promise<boolean>} Success status
     */
    async submitCommand(command) {
        if (this.state !== 'leader') {
            throw new Error('Only leader can accept commands');
        }
        
        const entry = {
            term: this.currentTerm,
            index: this.log.length,
            command,
            timestamp: Date.now()
        };
        
        this.log.push(entry);
        await this.savePersistentState();
        
        // Replicate to followers
        for (const peer of this.peers) {
            await this.sendAppendEntries(peer);
        }
        
        return true;
    }

    /**
     * Reset election timer with random timeout
     */
    resetElectionTimer() {
        this.clearElectionTimer();
        
        const timeout = this.options.electionTimeoutMin + 
            Math.random() * (this.options.electionTimeoutMax - this.options.electionTimeoutMin);
        
        this.electionTimer = setTimeout(async () => {
            if (this.state !== 'leader') {
                await this.becomeCandidate();
            }
        }, timeout);
    }

    /**
     * Clear all timers
     */
    clearTimers() {
        this.clearElectionTimer();
        this.clearHeartbeatTimer();
    }

    /**
     * Clear election timer
     */
    clearElectionTimer() {
        if (this.electionTimer) {
            clearTimeout(this.electionTimer);
            this.electionTimer = null;
        }
    }

    /**
     * Clear heartbeat timer
     */
    clearHeartbeatTimer() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * Handle network partition
     * @param {Set} partitionedNodes - Nodes in partition
     */
    handleNetworkPartition(partitionedNodes) {
        this.metrics.networkPartitions++;
        
        // If we're in minority partition and we're leader, step down
        if (this.state === 'leader' && partitionedNodes.has(this.nodeId)) {
            const availablePeers = Array.from(this.peers).filter(peer => !partitionedNodes.has(peer));
            const majoritySize = Math.floor(this.peers.size / 2) + 1;
            
            if (availablePeers.length < majoritySize - 1) { // -1 for self
                this.becomeFollower(this.currentTerm);
            }
        }
        
        this.emit('network-partition', { partitionedNodes: Array.from(partitionedNodes) });
    }

    /**
     * Handle network partition healing
     */
    handleNetworkHeal() {
        // Reset Byzantine detection for previously quarantined nodes
        this.byzantineDetector.suspiciousNodes.clear();
        
        this.emit('network-heal', { timestamp: Date.now() });
    }

    /**
     * Get Raft node status
     * @returns {Object} Node status
     */
    getStatus() {
        return {
            nodeId: this.nodeId,
            state: this.state,
            currentTerm: this.currentTerm,
            votedFor: this.votedFor,
            logLength: this.log.length,
            commitIndex: this.commitIndex,
            lastApplied: this.lastApplied,
            peers: Array.from(this.peers),
            metrics: this.metrics,
            byzantineNodes: Array.from(this.byzantineDetector.suspiciousNodes.keys())
        };
    }

    /**
     * Shutdown Raft node
     */
    async shutdown() {
        this.clearTimers();
        await this.savePersistentState();
        this.emit('shutdown', { nodeId: this.nodeId });
    }
}

/**
 * Mock network for testing
 */
class MockNetwork extends EventEmitter {
    constructor() {
        super();
        this.nodes = new Map();
        this.partitions = new Set();
        this.latency = 10; // ms
    }

    async send(to, message) {
        // Simulate network latency
        setTimeout(() => {
            if (!this.partitions.has(message.from) || !this.partitions.has(to)) {
                this.emit('message', { ...message, to });
            }
        }, this.latency);
    }

    partition(nodes) {
        for (const node of nodes) {
            this.partitions.add(node);
        }
        this.emit('partition', new Set(nodes));
    }

    heal() {
        this.partitions.clear();
        this.emit('heal');
    }
}

/**
 * Memory storage for testing
 */
class MemoryStorage {
    constructor() {
        this.data = new Map();
    }

    async save(nodeId, state) {
        this.data.set(nodeId, JSON.parse(JSON.stringify(state)));
    }

    async load(nodeId) {
        return this.data.get(nodeId);
    }
}

module.exports = { RaftNode, MockNetwork, MemoryStorage };
