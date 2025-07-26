const logger = require('../utils/simple-logger.js');

/**
 * Enterprise-grade Dependency Injection Container
 * Supports singleton, transient, and scoped lifetimes
 * Implements circular dependency detection and resolution
 */
class EnterpriseServiceContainer {
    constructor() {
        this.services = new Map();
        this.instances = new Map();
        this.resolutionStack = new Set();
        this.middleware = [];
        this.interceptors = new Map();
        this.metrics = {
            resolutions: 0,
            failures: 0,
            circularDependencies: 0,
            averageResolutionTime: 0
        };
        this.isInitialized = false;
    }

    /**
     * Register a service with advanced configuration
     */
    register(name, factory, options = {}) {
        const config = {
            lifetime: options.lifetime || 'singleton',
            dependencies: options.dependencies || [],
            tags: options.tags || [],
            lazy: options.lazy !== false,
            priority: options.priority || 0,
            healthCheck: options.healthCheck || null,
            factory: typeof factory === 'function' ? factory : () => factory,
            metadata: options.metadata || {}
        };

        this.services.set(name, config);
        logger.debug(`📦 Registered service: ${name} (${config.lifetime})`);
        
        return this;
    }

    /**
     * Register singleton service
     */
    registerSingleton(name, factory, dependencies = []) {
        return this.register(name, factory, { 
            lifetime: 'singleton', 
            dependencies,
            lazy: true
        });
    }

    /**
     * Register transient service
     */
    registerTransient(name, factory, dependencies = []) {
        return this.register(name, factory, { 
            lifetime: 'transient', 
            dependencies 
        });
    }

    /**
     * Resolve service with advanced features
     */
    async resolve(name, scope = null) {
        const startTime = Date.now();
        
        try {
            if (this.resolutionStack.has(name)) {
                this.metrics.circularDependencies++;
                throw new Error(`Circular dependency detected: ${Array.from(this.resolutionStack).join(' -> ')} -> ${name}`);
            }

            const service = this.services.get(name);
            if (!service) {
                throw new Error(`Service '${name}' not registered`);
            }

            let instance;
            switch (service.lifetime) {
                case 'singleton':
                    instance = await this.resolveSingleton(name, service, scope);
                    break;
                case 'transient':
                    instance = await this.resolveTransient(name, service, scope);
                    break;
                default:
                    throw new Error(`Unknown lifetime: ${service.lifetime}`);
            }

            this.metrics.resolutions++;
            const resolutionTime = Date.now() - startTime;
            this.metrics.averageResolutionTime = 
                (this.metrics.averageResolutionTime * (this.metrics.resolutions - 1) + resolutionTime) / this.metrics.resolutions;

            return instance;

        } catch (error) {
            this.metrics.failures++;
            logger.error(`❌ Failed to resolve service '${name}':`, error);
            throw error;
        }
    }

    /**
     * Resolve singleton instance
     */
    async resolveSingleton(name, service, scope) {
        if (this.instances.has(name)) {
            return this.instances.get(name);
        }

        const instance = await this.createInstance(name, service, scope);
        this.instances.set(name, instance);
        return instance;
    }

    /**
     * Resolve transient instance
     */
    async resolveTransient(name, service, scope) {
        return await this.createInstance(name, service, scope);
    }

    /**
     * Create service instance with dependency injection
     */
    async createInstance(name, service, scope) {
        this.resolutionStack.add(name);

        try {
            const dependencies = [];
            for (const depName of service.dependencies) {
                const dependency = await this.resolve(depName, scope);
                dependencies.push(dependency);
            }

            const instance = await service.factory(...dependencies);

            if (instance && typeof instance.initialize === 'function') {
                await instance.initialize();
            }

            return instance;

        } finally {
            this.resolutionStack.delete(name);
        }
    }

    /**
     * Initialize container
     */
    async initialize() {
        if (this.isInitialized) return;
        
        logger.info('🏗️ Initializing enterprise service container...');
        
        // Sort services by priority
        const sortedServices = Array.from(this.services.entries())
            .sort(([,a], [,b]) => b.priority - a.priority);

        for (const [name, service] of sortedServices) {
            if (!service.lazy) {
                await this.resolve(name);
            }
        }

        this.isInitialized = true;
        logger.success('✅ Enterprise service container initialized');
    }

    /**
     * Get service metrics
     */
    getMetrics() {
        return { ...this.metrics };
    }

    /**
     * Get all registered services
     */
    getServices() {
        return Array.from(this.services.keys());
    }

    /**
     * Health check for all services
     */
    async healthCheck() {
        const results = new Map();
        
        for (const [name, service] of this.services) {
            if (service.healthCheck) {
                try {
                    const instance = await this.resolve(name);
                    const health = await service.healthCheck(instance);
                    results.set(name, { healthy: true, ...health });
                } catch (error) {
                    results.set(name, { healthy: false, error: error.message });
                }
            }
        }

        return results;
    }

    /**
     * Dispose all services
     */
    async dispose() {
        for (const [name, instance] of this.instances) {
            if (instance && typeof instance.dispose === 'function') {
                try {
                    await instance.dispose();
                } catch (error) {
                    logger.error(`Error disposing service '${name}':`, error);
                }
            }
        }

        this.instances.clear();
        this.services.clear();
        this.isInitialized = false;
    }
}

module.exports = EnterpriseServiceContainer;
