'use strict';

const shutterState = require('./shutterState.js');  // shutterState
let checkShutterState = true;

/**
 * Ermittelt die Ziel-Lamellenneigung passend zur aktuellen Rollladen-Aktion.
 * Rückgabe null bedeutet: kein Slat-Wert für diese Aktion definiert -> nicht schreiben.
 *
 * @param currentShutterSettings
 */
function getSlatTarget(currentShutterSettings) {
    const action = currentShutterSettings.currentAction;

    switch (action) {
        case 'sunProtect':
        case 'OpenInSunProtect':
            return currentShutterSettings.slatHeightDownSun !== undefined && currentShutterSettings.slatHeightDownSun !== ''
                ? parseFloat(currentShutterSettings.slatHeightDownSun)
                : null;
        case 'up':
            return currentShutterSettings.slatHeightUp !== undefined && currentShutterSettings.slatHeightUp !== ''
                ? parseFloat(currentShutterSettings.slatHeightUp)
                : null;
        case 'down':
        case 'middle':
        case 'Xmas':
            return currentShutterSettings.slatHeightDown !== undefined && currentShutterSettings.slatHeightDown !== ''
                ? parseFloat(currentShutterSettings.slatHeightDown)
                : null;
        default:
            return null;
    }
}

/**
 * Wartet, bis die Lamelle ihre zuletzt gesetzte Zielposition (targetPosition) tatsächlich erreicht hat
 * (Istwert aus slatCurrentId == Zielwert aus slatId), bevor ein neuer Lamellenwert geschrieben wird.
 * So wird verhindert, dass ein neuer Befehl gesendet wird, während der Aktor die Lamelle noch verstellt.
 * Ohne konfigurierten slatCurrentId (Feedback-State) wird nicht gewartet.
 *
 * @param adapter
 * @param currentShutterSettings
 */
async function waitForSlatIdle(adapter, currentShutterSettings) {
    if (!currentShutterSettings.slatCurrentId) {
        return;
    }

    const timeout = currentShutterSettings.slatWaitTimeout ? parseInt(currentShutterSettings.slatWaitTimeout, 10) : 30000;
    const interval = currentShutterSettings.slatWaitInterval ? parseInt(currentShutterSettings.slatWaitInterval, 10) : 1000;
    const tolerance = 1;
    const start = Date.now();

    while (Date.now() - start < timeout) {
        let current;
        let target;

        try {
            current = await adapter.getForeignStateAsync(currentShutterSettings.slatCurrentId);
            target = await adapter.getForeignStateAsync(currentShutterSettings.slatId);
        } catch (err) {
            adapter.log.warn(`Slat-Status für ${currentShutterSettings.shutterName} konnte nicht gelesen werden: ${err}`);
            return;
        }

        if (!current || current.val === null || current.val === undefined || !target || target.val === null || target.val === undefined) {
            // Kein verwertbarer Wert (z. B. erster Lauf, noch kein Target gesetzt) -> nicht blockieren
            return;
        }

        if (Math.abs(parseFloat(current.val) - parseFloat(target.val)) <= tolerance) {
            return;
        }

        await new Promise((r) => setTimeout(r, interval));
    }

    adapter.log.debug(`Timeout beim Warten auf Lamellen-Endposition (${currentShutterSettings.shutterName}) - fahre trotzdem fort`);
}

async function setShutterState(adapter, shutterSettings, currentShutterSettings, shutterHeight, nameDevice, logInfo) {
    return new Promise(async (resolve) => {
        adapter.log.info(`${logInfo} Set ID: ${currentShutterSettings.shutterName} value: ${shutterHeight}%`);

        try {
            await adapter.setForeignStateAsync(currentShutterSettings.name, shutterHeight, false);
        } catch (err) {
            adapter.log.warn(`The value for ${currentShutterSettings.shutterName} could not be set: ${err}`);
        }

        // --- Lamellenneigung (Slat/Tilt) ---
        if (currentShutterSettings.slatEnabled && currentShutterSettings.slatId) {
            const slatTarget = getSlatTarget(currentShutterSettings);

            if (slatTarget !== null && !isNaN(slatTarget)) {
                await waitForSlatIdle(adapter, currentShutterSettings);

                adapter.log.info(`${logInfo} Set Slat ID: ${currentShutterSettings.slatId} value: ${slatTarget}%`);

                try {
                    await adapter.setForeignStateAsync(currentShutterSettings.slatId, slatTarget, false);
                } catch (err) {
                    adapter.log.warn(`The slat value for ${currentShutterSettings.shutterName} could not be set: ${err}`);
                }
            }
        }
        // --- Ende Lamellenneigung ---

        checkShutterState = false;
        await setShutterInfo(adapter, shutterSettings, currentShutterSettings, nameDevice);

        // @ts-ignore
        resolve();
    });
}

/**
 * @param adapter
 * @param shutterSettings
 * @param currentShutterSettings
 * @param nameDevice
 */
async function setShutterInfo(adapter, shutterSettings, currentShutterSettings, nameDevice) {
    return new Promise(async (resolve) => {
        try {
            await adapter.setStateAsync(`shutters.autoLevel.${  nameDevice}`, { val: parseFloat(currentShutterSettings.currentHeight), ack: true });
            await adapter.setStateAsync(`shutters.autoState.${  nameDevice}`, { val: currentShutterSettings.currentAction, ack: true });
        } catch (err) {
            adapter.log.warn(`autoState and/or Level for Shutter ${nameDevice} could not be set: ${err}`);
        }
        if (checkShutterState) {
            await shutterState(currentShutterSettings.name, adapter, shutterSettings, false);
        }

        // @ts-ignore
        resolve();
    });
}

module.exports = {
    setShutterState,
    setShutterInfo
};
