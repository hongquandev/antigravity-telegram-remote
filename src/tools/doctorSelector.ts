import { CdpService } from '../services/cdpService';
import { CDP_PORTS } from '../utils/cdpPorts';
import { RESPONSE_SELECTORS } from '../services/responseMonitor';
import { logger } from '../utils/logger';

async function main() {
    const service = new CdpService({ portsToScan: [...CDP_PORTS] });
    
    try {
        logger.info('🩺 Start Doctor Selector - Auditing Antigravity UI...');
        
        try {
            await service.connect();
        } catch (e: any) {
            logger.error(`❌ Could not connect to any Antigravity tab: ${e.message}`);
            process.exit(1);
        }

        if (!service.isConnected()) {
            logger.error('❌ Connection failed unexpectedly.');
            process.exit(1);
        }

        const selectors: Record<string, string> = {
            'Chat Message (Text)': RESPONSE_SELECTORS.RESPONSE_TEXT,
            'Stop Button (State)': RESPONSE_SELECTORS.STOP_BUTTON,
            'Planning Active (Dialog)': RESPONSE_SELECTORS.PLANNING_ACTIVE,
            'Process Logs (Activity)': RESPONSE_SELECTORS.PROCESS_LOGS,
            'Combined Poll (Logic)': RESPONSE_SELECTORS.COMBINED_POLL,
            'Quota Error (Detection)': RESPONSE_SELECTORS.QUOTA_ERROR,
            'DOM Observer (Event-driven)': RESPONSE_SELECTORS.DOM_OBSERVER
        };

        let healthCount = 0;
        let totalCount = 0;

        for (const [name, expression] of Object.entries(selectors)) {
            totalCount++;
            logger.info(`Checking: [${name}]...`);
            
            try {
                const res: any = await service.call('Runtime.evaluate', {
                    expression: `(function() { 
                        try { 
                            const result = ${expression}; 
                            return { ok: true, data: result }; 
                        } catch(e) { 
                            return { ok: false, error: e.message }; 
                        } 
                    })()`,
                    returnByValue: true
                });

                const value = res?.result?.value;
                if (value?.ok) {
                    const data = value.data;
                    const isHealthy = data !== null && data !== undefined;
                    
                    if (isHealthy) {
                        console.log(`  ✅ Healthy: Found and extracted data.`);
                        if (typeof data === 'object') {
                            console.log(`    Data: ${JSON.stringify(data)}`);
                        }
                        healthCount++;
                    } else {
                        console.log(`  ⚠️  Warning: Found but returned null/undefined.`);
                    }
                } else {
                    console.log(`  ❌ Broken: ${value?.error || 'Unknown evaluation error'}`);
                }
            } catch (err: any) {
                console.log(`  ❌ CDP Call Error: ${err.message}`);
            }
        }

        console.log('\n--- Final Selector Health Report ---');
        const scoreColor = healthCount === totalCount ? '✨' : '⚠️';
        logger.info(`${scoreColor} Score: ${healthCount}/${totalCount} Healthy`);
        
        if (healthCount === totalCount) {
            logger.info('✅ All core selectors are healthy. The bot is in top shape!');
        } else if (healthCount > 0) {
            logger.warn('🚨 Some selectors failed. Compatibility might be compromised.');
        } else {
            logger.error('💀 All selectors failed! The UI has likely changed significantly.');
        }

    } catch (err: any) {
        logger.error('💥 Doctor collapsed:', err.message);
    } finally {
        await service.disconnect();
    }
}

main();
