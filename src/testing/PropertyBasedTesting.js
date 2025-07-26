/**
 * Property-Based Testing Framework
 * Generates random test cases to verify system properties and invariants
 * Features: Shrinking, custom generators, stateful testing, parallel execution
 */
const { EventEmitter } = require('events');

class PropertyBasedTesting extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            maxTests: options.maxTests || 100,
            maxShrinks: options.maxShrinks || 100,
            seed: options.seed || Date.now(),
            timeout: options.timeout || 5000,
            parallel: options.parallel || false,
            maxParallel: options.maxParallel || 4,
            verbose: options.verbose || false,
            ...options
        };
        
        // Test properties registry
        this.properties = new Map(); // propertyName -> property definition
        
        // Generators registry
        this.generators = new Map(); // generatorName -> generator function
        
        // Test results
        this.results = new Map(); // propertyName -> test results
        
        // Random number generator with seed
        this.rng = new SeededRandom(this.options.seed);
        
        // Shrinking strategies
        this.shrinkers = new Map(); // type -> shrinking function
        
        // Test execution metrics
        this.metrics = {
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            shrinkingAttempts: 0,
            executionTime: 0,
            propertiesRun: 0
        };
        
        this.initializeBuiltinGenerators();
        this.initializeBuiltinShrinkers();
    }

    /**
     * Initialize built-in generators
     */
    initializeBuiltinGenerators() {
        // Primitive generators
        this.registerGenerator('boolean', () => this.rng.nextBoolean());
        this.registerGenerator('integer', (min = -1000, max = 1000) => 
            this.rng.nextInt(min, max));
        this.registerGenerator('float', (min = -1000, max = 1000) => 
            this.rng.nextFloat(min, max));
        this.registerGenerator('string', (maxLength = 50) => 
            this.generateString(maxLength));
        this.registerGenerator('ascii', (maxLength = 50) => 
            this.generateAsciiString(maxLength));
        
        // Collection generators
        this.registerGenerator('array', (elementGen, maxSize = 20) => 
            this.generateArray(elementGen, maxSize));
        this.registerGenerator('object', (schema) => 
            this.generateObject(schema));
        this.registerGenerator('map', (keyGen, valueGen, maxSize = 20) => 
            this.generateMap(keyGen, valueGen, maxSize));
        
        // Composite generators
        this.registerGenerator('oneOf', (...generators) => 
            this.generateOneOf(generators));
        this.registerGenerator('frequency', (weightedGenerators) => 
            this.generateFrequency(weightedGenerators));
        this.registerGenerator('tuple', (...generators) => 
            this.generateTuple(generators));
        
        // Domain-specific generators
        this.registerGenerator('email', () => this.generateEmail());
        this.registerGenerator('url', () => this.generateUrl());
        this.registerGenerator('uuid', () => this.generateUuid());
        this.registerGenerator('date', (start, end) => this.generateDate(start, end));
    }

    /**
     * Initialize built-in shrinkers
     */
    initializeBuiltinShrinkers() {
        this.registerShrinker('number', (value) => this.shrinkNumber(value));
        this.registerShrinker('string', (value) => this.shrinkString(value));
        this.registerShrinker('array', (value) => this.shrinkArray(value));
        this.registerShrinker('object', (value) => this.shrinkObject(value));
    }

    /**
     * Register a property to test
     * @param {string} name - Property name
     * @param {Function} property - Property function
     * @param {Object} options - Property options
     */
    property(name, property, options = {}) {
        this.properties.set(name, {
            name,
            property,
            generators: options.generators || [],
            precondition: options.precondition,
            maxTests: options.maxTests || this.options.maxTests,
            timeout: options.timeout || this.options.timeout,
            shrink: options.shrink !== false,
            examples: options.examples || [],
            tags: options.tags || []
        });
        
        return this;
    }

    /**
     * Register a custom generator
     * @param {string} name - Generator name
     * @param {Function} generator - Generator function
     */
    registerGenerator(name, generator) {
        this.generators.set(name, generator);
        return this;
    }

    /**
     * Register a custom shrinker
     * @param {string} type - Data type
     * @param {Function} shrinker - Shrinking function
     */
    registerShrinker(type, shrinker) {
        this.shrinkers.set(type, shrinker);
        return this;
    }

    /**
     * Run all registered properties
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Test results
     */
    async runAll(options = {}) {
        const startTime = Date.now();
        const results = new Map();
        
        const propertiesToRun = Array.from(this.properties.values())
            .filter(prop => this.shouldRunProperty(prop, options));
        
        if (this.options.parallel) {
            // Run properties in parallel
            const chunks = this.chunkArray(propertiesToRun, this.options.maxParallel);
            
            for (const chunk of chunks) {
                const promises = chunk.map(prop => this.runProperty(prop.name));
                const chunkResults = await Promise.allSettled(promises);
                
                chunkResults.forEach((result, index) => {
                    const propName = chunk[index].name;
                    results.set(propName, result.status === 'fulfilled' ? result.value : {
                        success: false,
                        error: result.reason,
                        tests: 0
                    });
                });
            }
        } else {
            // Run properties sequentially
            for (const prop of propertiesToRun) {
                const result = await this.runProperty(prop.name);
                results.set(prop.name, result);
            }
        }
        
        // Update metrics
        this.metrics.executionTime = Date.now() - startTime;
        this.metrics.propertiesRun = results.size;
        
        // Store results
        this.results = results;
        
        const summary = this.generateSummary(results);
        this.emit('run-complete', summary);
        
        return summary;
    }

    /**
     * Run a specific property
     * @param {string} propertyName - Property name
     * @returns {Promise<Object>} Test result
     */
    async runProperty(propertyName) {
        const propertyDef = this.properties.get(propertyName);
        if (!propertyDef) {
            throw new Error(`Property not found: ${propertyName}`);
        }
        
        const startTime = Date.now();
        let tests = 0;
        let failures = [];
        
        try {
            // Run explicit examples first
            for (const example of propertyDef.examples) {
                tests++;
                const result = await this.runSingleTest(propertyDef, example, true);
                if (!result.success) {
                    failures.push(result);
                }
            }
            
            // Generate and run random test cases
            for (let i = 0; i < propertyDef.maxTests; i++) {
                tests++;
                this.metrics.totalTests++;
                
                const testCase = this.generateTestCase(propertyDef);
                
                // Check precondition
                if (propertyDef.precondition && !propertyDef.precondition(...testCase)) {
                    continue;
                }
                
                const result = await this.runSingleTest(propertyDef, testCase);
                
                if (result.success) {
                    this.metrics.passedTests++;
                } else {
                    this.metrics.failedTests++;
                    
                    // Attempt shrinking if enabled
                    if (propertyDef.shrink) {
                        const shrunkCase = await this.shrinkTestCase(propertyDef, testCase);
                        result.shrunkInput = shrunkCase;
                    }
                    
                    failures.push(result);
                    
                    // Stop on first failure for faster feedback
                    break;
                }
            }
            
            const executionTime = Date.now() - startTime;
            
            return {
                property: propertyName,
                success: failures.length === 0,
                tests,
                failures,
                executionTime,
                seed: this.options.seed
            };
            
        } catch (error) {
            return {
                property: propertyName,
                success: false,
                tests,
                error: error.message,
                executionTime: Date.now() - startTime
            };
        }
    }

    /**
     * Run a single test case
     * @param {Object} propertyDef - Property definition
     * @param {Array} testCase - Test case arguments
     * @param {boolean} isExample - Is this an explicit example
     * @returns {Promise<Object>} Test result
     */
    async runSingleTest(propertyDef, testCase, isExample = false) {
        const startTime = Date.now();
        
        try {
            // Execute with timeout
            const result = await this.executeWithTimeout(
                () => propertyDef.property(...testCase),
                propertyDef.timeout
            );
            
            return {
                success: result === true || result === undefined,
                input: testCase,
                output: result,
                executionTime: Date.now() - startTime,
                isExample
            };
            
        } catch (error) {
            return {
                success: false,
                input: testCase,
                error: error.message,
                stack: error.stack,
                executionTime: Date.now() - startTime,
                isExample
            };
        }
    }

    /**
     * Generate test case for property
     * @param {Object} propertyDef - Property definition
     * @returns {Array} Generated test case
     */
    generateTestCase(propertyDef) {
        const testCase = [];
        
        for (const generatorSpec of propertyDef.generators) {
            if (typeof generatorSpec === 'string') {
                // Simple generator name
                const generator = this.generators.get(generatorSpec);
                if (!generator) {
                    throw new Error(`Generator not found: ${generatorSpec}`);
                }
                testCase.push(generator());
            } else if (typeof generatorSpec === 'object') {
                // Generator with parameters
                const { type, ...params } = generatorSpec;
                const generator = this.generators.get(type);
                if (!generator) {
                    throw new Error(`Generator not found: ${type}`);
                }
                testCase.push(generator(...Object.values(params)));
            } else if (typeof generatorSpec === 'function') {
                // Custom generator function
                testCase.push(generatorSpec(this.rng));
            }
        }
        
        return testCase;
    }

    /**
     * Shrink test case to find minimal failing example
     * @param {Object} propertyDef - Property definition
     * @param {Array} failingCase - Failing test case
     * @returns {Promise<Array>} Shrunk test case
     */
    async shrinkTestCase(propertyDef, failingCase) {
        let currentCase = [...failingCase];
        let shrinkAttempts = 0;
        
        while (shrinkAttempts < this.options.maxShrinks) {
            let foundSmallerCase = false;
            
            // Try shrinking each argument
            for (let i = 0; i < currentCase.length; i++) {
                const candidates = this.generateShrinkCandidates(currentCase[i]);
                
                for (const candidate of candidates) {
                    const testCase = [...currentCase];
                    testCase[i] = candidate;
                    
                    // Check if shrunk case still fails
                    const result = await this.runSingleTest(propertyDef, testCase);
                    
                    if (!result.success) {
                        currentCase = testCase;
                        foundSmallerCase = true;
                        break;
                    }
                }
                
                if (foundSmallerCase) break;
            }
            
            if (!foundSmallerCase) break;
            
            shrinkAttempts++;
            this.metrics.shrinkingAttempts++;
        }
        
        return currentCase;
    }

    /**
     * Generate shrink candidates for a value
     * @param {*} value - Value to shrink
     * @returns {Array} Shrink candidates
     */
    generateShrinkCandidates(value) {
        const type = this.getValueType(value);
        const shrinker = this.shrinkers.get(type);
        
        if (shrinker) {
            return shrinker(value);
        }
        
        return []; // No shrinking available
    }

    /**
     * Get value type for shrinking
     * @param {*} value - Value to type
     * @returns {string} Value type
     */
    getValueType(value) {
        if (typeof value === 'number') return 'number';
        if (typeof value === 'string') return 'string';
        if (Array.isArray(value)) return 'array';
        if (typeof value === 'object' && value !== null) return 'object';
        return 'unknown';
    }

    /**
     * Generate string with random characters
     * @param {number} maxLength - Maximum string length
     * @returns {string} Generated string
     */
    generateString(maxLength) {
        const length = this.rng.nextInt(0, maxLength);
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()';
        let result = '';
        
        for (let i = 0; i < length; i++) {
            result += chars[this.rng.nextInt(0, chars.length - 1)];
        }
        
        return result;
    }

    /**
     * Generate ASCII string
     * @param {number} maxLength - Maximum string length
     * @returns {string} Generated ASCII string
     */
    generateAsciiString(maxLength) {
        const length = this.rng.nextInt(0, maxLength);
        let result = '';
        
        for (let i = 0; i < length; i++) {
            result += String.fromCharCode(this.rng.nextInt(32, 126));
        }
        
        return result;
    }

    /**
     * Generate array with random elements
     * @param {Function} elementGen - Element generator
     * @param {number} maxSize - Maximum array size
     * @returns {Array} Generated array
     */
    generateArray(elementGen, maxSize) {
        const size = this.rng.nextInt(0, maxSize);
        const result = [];
        
        for (let i = 0; i < size; i++) {
            result.push(elementGen(this.rng));
        }
        
        return result;
    }

    /**
     * Generate object from schema
     * @param {Object} schema - Object schema
     * @returns {Object} Generated object
     */
    generateObject(schema) {
        const result = {};
        
        for (const [key, generator] of Object.entries(schema)) {
            if (typeof generator === 'string') {
                const gen = this.generators.get(generator);
                result[key] = gen ? gen() : null;
            } else if (typeof generator === 'function') {
                result[key] = generator(this.rng);
            }
        }
        
        return result;
    }

    /**
     * Generate map with random key-value pairs
     * @param {Function} keyGen - Key generator
     * @param {Function} valueGen - Value generator
     * @param {number} maxSize - Maximum map size
     * @returns {Map} Generated map
     */
    generateMap(keyGen, valueGen, maxSize) {
        const size = this.rng.nextInt(0, maxSize);
        const result = new Map();
        
        for (let i = 0; i < size; i++) {
            const key = keyGen(this.rng);
            const value = valueGen(this.rng);
            result.set(key, value);
        }
        
        return result;
    }

    /**
     * Generate one of the provided generators
     * @param {Array} generators - Array of generators
     * @returns {*} Generated value
     */
    generateOneOf(generators) {
        const index = this.rng.nextInt(0, generators.length - 1);
        const generator = generators[index];
        
        if (typeof generator === 'string') {
            return this.generators.get(generator)();
        } else if (typeof generator === 'function') {
            return generator(this.rng);
        }
        
        return generator;
    }

    /**
     * Generate using frequency-weighted generators
     * @param {Array} weightedGenerators - Array of [weight, generator] pairs
     * @returns {*} Generated value
     */
    generateFrequency(weightedGenerators) {
        const totalWeight = weightedGenerators.reduce((sum, [weight]) => sum + weight, 0);
        let random = this.rng.nextFloat(0, totalWeight);
        
        for (const [weight, generator] of weightedGenerators) {
            random -= weight;
            if (random <= 0) {
                if (typeof generator === 'function') {
                    return generator(this.rng);
                }
                return generator;
            }
        }
        
        // Fallback to first generator
        return weightedGenerators[0][1](this.rng);
    }

    /**
     * Generate tuple from generators
     * @param {Array} generators - Array of generators
     * @returns {Array} Generated tuple
     */
    generateTuple(generators) {
        return generators.map(gen => {
            if (typeof gen === 'string') {
                return this.generators.get(gen)();
            } else if (typeof gen === 'function') {
                return gen(this.rng);
            }
            return gen;
        });
    }

    /**
     * Generate email address
     * @returns {string} Generated email
     */
    generateEmail() {
        const domains = ['example.com', 'test.org', 'sample.net', 'demo.io'];
        const username = this.generateAsciiString(10).replace(/[^a-zA-Z0-9]/g, '');
        const domain = domains[this.rng.nextInt(0, domains.length - 1)];
        return `${username}@${domain}`;
    }

    /**
     * Generate URL
     * @returns {string} Generated URL
     */
    generateUrl() {
        const protocols = ['http', 'https'];
        const domains = ['example.com', 'test.org', 'sample.net'];
        const protocol = protocols[this.rng.nextInt(0, protocols.length - 1)];
        const domain = domains[this.rng.nextInt(0, domains.length - 1)];
        const path = this.generateAsciiString(20).replace(/[^a-zA-Z0-9]/g, '');
        return `${protocol}://${domain}/${path}`;
    }

    /**
     * Generate UUID
     * @returns {string} Generated UUID
     */
    generateUuid() {
        const crypto = require('crypto');
        return crypto.randomUUID();
    }

    /**
     * Generate date
     * @param {Date} start - Start date
     * @param {Date} end - End date
     * @returns {Date} Generated date
     */
    generateDate(start = new Date(2020, 0, 1), end = new Date()) {
        const startTime = start.getTime();
        const endTime = end.getTime();
        const randomTime = this.rng.nextInt(startTime, endTime);
        return new Date(randomTime);
    }

    /**
     * Shrink number towards zero
     * @param {number} value - Number to shrink
     * @returns {Array} Shrink candidates
     */
    shrinkNumber(value) {
        const candidates = [];
        
        if (value !== 0) {
            candidates.push(0);
        }
        
        if (Math.abs(value) > 1) {
            candidates.push(Math.floor(value / 2));
            candidates.push(Math.ceil(value / 2));
        }
        
        if (value > 0) {
            candidates.push(value - 1);
        } else if (value < 0) {
            candidates.push(value + 1);
        }
        
        return candidates.filter(c => c !== value);
    }

    /**
     * Shrink string towards empty string
     * @param {string} value - String to shrink
     * @returns {Array} Shrink candidates
     */
    shrinkString(value) {
        const candidates = [];
        
        if (value.length > 0) {
            candidates.push('');
        }
        
        if (value.length > 1) {
            candidates.push(value.substring(0, Math.floor(value.length / 2)));
            candidates.push(value.substring(Math.ceil(value.length / 2)));
        }
        
        return candidates;
    }

    /**
     * Shrink array towards empty array
     * @param {Array} value - Array to shrink
     * @returns {Array} Shrink candidates
     */
    shrinkArray(value) {
        const candidates = [];
        
        if (value.length > 0) {
            candidates.push([]);
        }
        
        if (value.length > 1) {
            candidates.push(value.slice(0, Math.floor(value.length / 2)));
            candidates.push(value.slice(Math.ceil(value.length / 2)));
        }
        
        return candidates;
    }

    /**
     * Shrink object by removing properties
     * @param {Object} value - Object to shrink
     * @returns {Array} Shrink candidates
     */
    shrinkObject(value) {
        const candidates = [];
        const keys = Object.keys(value);
        
        if (keys.length > 0) {
            candidates.push({});
        }
        
        // Remove one property at a time
        for (const key of keys) {
            const shrunk = { ...value };
            delete shrunk[key];
            candidates.push(shrunk);
        }
        
        return candidates;
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
                reject(new Error(`Test timed out after ${timeout}ms`));
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
     * Check if property should run based on options
     * @param {Object} property - Property definition
     * @param {Object} options - Run options
     * @returns {boolean} Should run
     */
    shouldRunProperty(property, options) {
        if (options.only && !options.only.includes(property.name)) {
            return false;
        }
        
        if (options.skip && options.skip.includes(property.name)) {
            return false;
        }
        
        if (options.tags && options.tags.length > 0) {
            return property.tags.some(tag => options.tags.includes(tag));
        }
        
        return true;
    }

    /**
     * Chunk array into smaller arrays
     * @param {Array} array - Array to chunk
     * @param {number} size - Chunk size
     * @returns {Array} Chunked arrays
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Generate test summary
     * @param {Map} results - Test results
     * @returns {Object} Test summary
     */
    generateSummary(results) {
        const summary = {
            totalProperties: results.size,
            passedProperties: 0,
            failedProperties: 0,
            totalTests: 0,
            totalFailures: 0,
            executionTime: this.metrics.executionTime,
            seed: this.options.seed,
            results: Array.from(results.values())
        };
        
        for (const result of results.values()) {
            if (result.success) {
                summary.passedProperties++;
            } else {
                summary.failedProperties++;
            }
            
            summary.totalTests += result.tests || 0;
            summary.totalFailures += result.failures?.length || 0;
        }
        
        return summary;
    }

    /**
     * Get testing metrics
     * @returns {Object} Metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            registeredProperties: this.properties.size,
            registeredGenerators: this.generators.size,
            registeredShrinkers: this.shrinkers.size
        };
    }
}

/**
 * Seeded random number generator for reproducible tests
 */
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
        this.state = seed;
    }

    next() {
        // Linear congruential generator
        this.state = (this.state * 1664525 + 1013904223) % 4294967296;
        return this.state / 4294967296;
    }

    nextInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    nextFloat(min, max) {
        return this.next() * (max - min) + min;
    }

    nextBoolean() {
        return this.next() < 0.5;
    }
}

module.exports = { PropertyBasedTesting, SeededRandom };
