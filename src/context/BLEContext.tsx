// src/context/BLEContext.tsx
import React, { createContext, useContext, useEffect, useReducer, useRef } from 'react';
import { BleManager, Device, Subscription, State as BLEPowerState, Characteristic } from 'react-native-ble-plx';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
import { HeatshrinkDecoder } from 'heatshrink-ts';
import { storeFile, getFileContent, getLocalFileNames, getStoredFiles, cleanupOldFiles } from '@/src/service/DataService';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';


const VSP_SERVICE_UUID = '569a1101-b87f-490c-92cb-11ba5ea5167c';
const VSP_TX_UUID = '569a2000-b87f-490c-92cb-11ba5ea5167c';
const VSP_RX_UUID = '569a2001-b87f-490c-92cb-11ba5ea5167c';
const BACKGROUND_RECONNECT_TASK = 'background-reconnect-task';

const NAME_FILTER_PREFIX = 'DU-';

interface FileInfo {
    fileName: string;
    size: number;
    timestamp: Date;
}

type BLEState = {
    manager: BleManager;
    device: Device | null;
    connected: boolean;
    connecting: boolean;
    searching: boolean;
    authenticating: boolean;
    syncingFiles: boolean;
    files: FileInfo[];
    error: string | null;
    navigationReady: boolean;
    statusMessage: string;
    initialSyncComplete: boolean;
    reconnecting: boolean;
    reconnectAttempts: number;
    lastConnectedSerial: string | null;
    reconnectionInProgress: boolean;
    isPeriodicReconnect: boolean;
};

type BLEAction =
    | { type: 'SEARCH_START' }
    | { type: 'SEARCH_SUCCESS' }
    | { type: 'CONNECT_START' }
    | { type: 'CONNECT_SUCCESS'; payload: Device }
    | { type: 'AUTH_START' }
    | { type: 'AUTH_SUCCESS' }
    | { type: 'SYNC_START' }
    | { type: 'SYNC_SUCCESS'; payload: FileInfo[] }
    | { type: 'SYNC_ERROR'; payload: string }
    | { type: 'CONNECT_FAIL'; payload: string }
    | { type: 'DISCONNECT' }
    | { type: 'AUTO_DISCONNECT' }
    | { type: 'IMMEDIATE_CLEANUP' }
    | { type: 'UPDATE_FILES'; payload: FileInfo[] }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'SET_STATUS'; payload: string }
    | { type: 'SET_NAVIGATION_READY'; payload: boolean }
    | { type: 'INITIAL_SYNC_COMPLETE' }
    | { type: 'RECONNECT_START' }
    | { type: 'RECONNECT_SUCCESS' }
    | { type: 'RECONNECT_FAILED' }
    | { type: 'SET_LAST_SERIAL'; payload: string }
    | { type: 'SET_PERIODIC_RECONNECT'; payload: boolean }
    | { type: 'SILENT_STATUS_UPDATE'; payload: string };

const initialState: BLEState = {
    manager: new BleManager(),
    device: null,
    connected: false,
    connecting: false,
    searching: false,
    authenticating: false,
    syncingFiles: false,
    files: [],
    error: null,
    navigationReady: false,
    statusMessage: '',
    initialSyncComplete: false,
    reconnecting: false,
    reconnectAttempts: 0,
    lastConnectedSerial: null,
    reconnectionInProgress: false,
    isPeriodicReconnect: false,
};

const reducer = (state: BLEState, action: BLEAction): BLEState => {
    switch (action.type) {
        case 'SEARCH_START':
            return {
                ...state,
                searching: true,
                connecting: true,
                authenticating: false,
                syncingFiles: false,
                error: null,
                navigationReady: state.isPeriodicReconnect ? state.navigationReady : false,
                statusMessage: state.isPeriodicReconnect ? 'Reconnecting...' : 'Searching for device...'
            };
        case 'SEARCH_SUCCESS':
            return {
                ...state,
                searching: false,
                statusMessage: state.isPeriodicReconnect ? 'Reconnecting...' : 'Device found'
            };
        case 'CONNECT_START':
            return {
                ...state,
                connecting: true,
                statusMessage: state.isPeriodicReconnect ? 'Reconnecting...' : 'Connecting to Deck Unit'
            };
        case 'AUTH_START':
            return {
                ...state,
                connecting: true,
                authenticating: true,
                statusMessage: state.isPeriodicReconnect ? 'Reconnecting...' : 'Authenticating...'
            };
        case 'AUTH_SUCCESS':
            return {
                ...state,
                authenticating: false,
                statusMessage: state.isPeriodicReconnect ? 'Reconnecting...' : 'Authentication successful'
            };
        case 'CONNECT_SUCCESS':
            return {
                ...state,
                device: action.payload,
                connected: true,
                connecting: false,
                authenticating: false,
                error: null,
                navigationReady: true,
                statusMessage: state.isPeriodicReconnect ? `Connected to ${action.payload.name?.split('-')[1] || 'Deck Unit'}` : 'Connected successfully',
                reconnecting: false,
                reconnectionInProgress: false,
                reconnectAttempts: 0,
                isPeriodicReconnect: false
            };
        case 'SYNC_START':
            return {
                ...state,
                syncingFiles: true,
                statusMessage: state.isPeriodicReconnect ? `Connected to ${state.device?.name?.split('-')[1] || 'Deck Unit'}` : 'Syncing files...'
            };
        case 'SYNC_SUCCESS':
            return {
                ...state,
                syncingFiles: false,
                files: action.payload,
                statusMessage: state.isPeriodicReconnect
                    ? `Connected to ${state.device?.name?.split('-')[1] || 'Deck Unit'}`
                    : (action.payload && action.payload.length > 0 ? `Synced ${action.payload.length} files` : 'No files found'),
                initialSyncComplete: true
            };
        case 'INITIAL_SYNC_COMPLETE':
            return {
                ...state,
                syncingFiles: false,
                statusMessage: 'Ready',
                initialSyncComplete: true,
            };
        case 'SYNC_ERROR':
            return {
                ...state,
                syncingFiles: false,
                error: state.isPeriodicReconnect ? null : action.payload,
                statusMessage: state.isPeriodicReconnect
                    ? `Connected to ${state.device?.name?.split('-')[1] || 'Deck Unit'}`
                    : 'File sync failed'
            };
        case 'CONNECT_FAIL':
            const isBluetoothOffError = action.payload.includes('BluetoothLE is powered off') ||
                action.payload.includes('Bluetooth');
            return {
                ...state,
                connecting: false,
                searching: false,
                authenticating: false,
                syncingFiles: false,
                navigationReady: state.isPeriodicReconnect ? state.navigationReady : false,
                error: (state.isPeriodicReconnect && !isBluetoothOffError) ? null : action.payload,
                statusMessage: isBluetoothOffError ? 'Bluetooth is turned off' :
                    (state.isPeriodicReconnect ? 'Disconnected' : ''),
                reconnecting: false,
                reconnectionInProgress: false,
                isPeriodicReconnect: false
            };
        case 'AUTO_DISCONNECT':
            return {
                ...state,
                device: null,
                connected: false,
                error: null,
                connecting: false,
                searching: false,
                authenticating: false,
                syncingFiles: false,
                navigationReady: false,
                statusMessage: 'Disconnected',
                isPeriodicReconnect: false,
                reconnecting: false,
                reconnectionInProgress: false,
            };
        case 'DISCONNECT':
            return {
                ...state,
                device: null,
                connected: false,
                error: null,
                connecting: false,
                searching: false,
                authenticating: false,
                syncingFiles: false,
                navigationReady: false,
                statusMessage: '',
                reconnecting: false,
                reconnectionInProgress: false,
                reconnectAttempts: 0,
                isPeriodicReconnect: false,
            };
        case 'SET_STATUS':
            return { ...state, statusMessage: action.payload };
        case 'SILENT_STATUS_UPDATE':
            return {
                ...state,
                statusMessage: action.payload,
                error: null
            };
        case 'UPDATE_FILES':
            return { ...state, files: action.payload };
        case 'SET_ERROR':
            return { ...state, error: action.payload };
        case 'SET_NAVIGATION_READY':
            return { ...state, navigationReady: action.payload };
        case 'SET_LAST_SERIAL':
            return { ...state, lastConnectedSerial: action.payload };
        case 'SET_PERIODIC_RECONNECT':
            return { ...state, isPeriodicReconnect: action.payload };
        case 'RECONNECT_START':
            return {
                ...state,
                reconnecting: true,
                reconnectionInProgress: true,
                reconnectAttempts: state.reconnectAttempts + 1,
                statusMessage: state.isPeriodicReconnect
                    ? 'Reconnecting...'
                    : `Reconnecting... (${state.reconnectAttempts + 1}/3)`
            };
        case 'RECONNECT_SUCCESS':
            return {
                ...state,
                reconnecting: false,
                reconnectionInProgress: false,
                reconnectAttempts: 0,
                statusMessage: `Connected to ${state.device?.name?.split('-')[1] || 'Deck Unit'}`,
            };
        case 'RECONNECT_FAILED':
            return {
                ...state,
                reconnecting: false,
                reconnectionInProgress: false,
                statusMessage: state.isPeriodicReconnect ? 'Disconnected' : 'Reconnection failed',
                isPeriodicReconnect: false
            };
        case 'IMMEDIATE_CLEANUP':
            return {
                ...initialState, // Reset to initial state
                manager: state.manager, // Keep the manager instance
            };
        default:
            return state;
    }
};

TaskManager.defineTask(BACKGROUND_RECONNECT_TASK, async () => {
    try {
        console.log('Background task executing...');

        // Get the stored serial
        const serial = await SecureStore.getItemAsync('deckSerial');
        if (!serial) {
            console.log('No serial found for background reconnect');
            return BackgroundFetch.BackgroundFetchResult.NoData;
        }

        // Check if already connected
        const manager = new BleManager();
        const state = await manager.state();

        if (state !== 'PoweredOn') {
            console.log('Bluetooth not powered on');
            return BackgroundFetch.BackgroundFetchResult.Failed;
        }

        console.log('Background reconnect triggered');

        return BackgroundFetch.BackgroundFetchResult.NewData;

    } catch (error) {
        console.log('Background task error:', error);
        return BackgroundFetch.BackgroundFetchResult.Failed;
    }
});

// Fixed Context type to match implementation
type Ctx = {
    state: BLEState;
    connect: (serial: string, isReconnection?: boolean, isPeriodicReconnect?: boolean) => Promise<void>;
    downloadFiles: (deviceOverride?: Device) => Promise<FileInfo[] | undefined>;
    refreshFiles: () => Promise<void>;
    disconnect: (isLogout?: boolean) => Promise<void>;
    forceStartPeriodicReconnect: () => void;
};

const BLEContext = createContext<Ctx | undefined>(undefined);

// Packet parsing types
type ParsedPkt = { opcode: string; payload: Uint8Array };

export const BLEProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, dispatch] = useReducer(reducer, initialState);

    // Configuration constants
    const CONFIG = {
        SCAN_TIMEOUT: 60000,
        CONNECTION_TIMEOUT: 30000,
        AUTH_TIMEOUT: 8000,
        CHUNK_TIMEOUT: 25000,
        FILE_TIMEOUT: 180000,
        AUTO_DISCONNECT_DELAY: 500,
        PERIODIC_RECONNECT_INTERVAL: 600000,
        STATUS_UPDATE_FREQUENCY: 50,
        MAX_RETRY_ATTEMPTS: 3,
        LARGE_FILE_THRESHOLD: 5
    };

    // Use refs for proper scope management
    const timersRef = useRef({
        autoDisconnect: null as ReturnType<typeof setTimeout> | null,
        periodicReconnect: null as ReturnType<typeof setInterval> | null,
        reconnectionTimeout: null as ReturnType<typeof setTimeout> | null
    });

    const subscriptionsRef = useRef({
        rx: null as Subscription | null,
        state: null as Subscription | null,
        connection: null as Subscription | null
    });

    const atomicOperations = useRef({
        connectionInProgress: false,
        scanInProgress: false
    });

    const lastConnectedSerialRef = useRef<string | null>(null);
    const reconnectionInProgressRef = useRef<boolean>(false);
    const statusUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const immediateCleanupRef = useRef<boolean>(false);


    // Packet buffer management
    const packetBufferRef = useRef(Buffer.alloc(0));
    const rxQueueRef = useRef<ParsedPkt[]>([]);


    // Utility functions
    const getErrorMessage = (error: unknown): string => {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        if (error && typeof error === 'object' && 'message' in error) {
            return String(error.message);
        }
        return 'An unknown error occurred';
    };

    const handleError = (error: any, context: string, shouldPropagate = true) => {
        const errorMessage = getErrorMessage(error);
        console.log(`[${context}] Error:`, errorMessage);

        // Don't propagate errors during file operations unless critical
        const isCriticalError = errorMessage.includes('disconnected') ||
            errorMessage.includes('cancelled') ||
            errorMessage.includes('timeout');

        if (shouldPropagate && !state.isPeriodicReconnect && isCriticalError) {
            dispatch({ type: 'SET_ERROR', payload: `${context}: ${errorMessage}` });
        }

        return errorMessage;
    };

    const debouncedStatusUpdate = (message: string, isImmediate = false) => {
        if (statusUpdateTimeoutRef.current) {
            clearTimeout(statusUpdateTimeoutRef.current);
        }

        if (isImmediate) {
            dispatch({ type: 'SET_STATUS', payload: message });
            return;
        }

        // Longer debounce time to reduce UI updates during intensive operations
        statusUpdateTimeoutRef.current = setTimeout(() => {
            dispatch({ type: 'SET_STATUS', payload: message });
        }, 300); // Increased from 100ms
    };

    const delay = (ms: number) => {
        return new Promise(res => setTimeout(res, ms));
    };

    // Clear all timers utility
    const clearAllTimers = () => {
        if (timersRef.current.autoDisconnect) {
            clearTimeout(timersRef.current.autoDisconnect);
            timersRef.current.autoDisconnect = null;
        }
        if (timersRef.current.periodicReconnect) {
            clearInterval(timersRef.current.periodicReconnect);
            timersRef.current.periodicReconnect = null;
        }
        if (timersRef.current.reconnectionTimeout) {
            clearTimeout(timersRef.current.reconnectionTimeout);
            timersRef.current.reconnectionTimeout = null;
        }
        if (statusUpdateTimeoutRef.current) {
            clearTimeout(statusUpdateTimeoutRef.current);
            statusUpdateTimeoutRef.current = null;
        }
    };

    // Packet parsing functions
    const parsePackets = () => {
        let packetsProcessed = 0;
        const MAX_PACKETS_PER_CALL = 10;

        while (packetsProcessed < MAX_PACKETS_PER_CALL) {
            if (packetBufferRef.current.length < 2) return;

            if (packetBufferRef.current[0] !== 0x2A) {
                console.log('Resyncing - looking for sync marker');
                const syncIndex = packetBufferRef.current.indexOf(0x2A);
                if (syncIndex === -1) {
                    packetBufferRef.current = Buffer.alloc(0);
                    return;
                }
                packetBufferRef.current = packetBufferRef.current.slice(syncIndex);
                if (packetBufferRef.current.length < 2) return;
            }

            const szByte = packetBufferRef.current[1];
            let totalLen = 0;
            let payloadLen = 0;
            let opcodeOffset = 0;
            let payloadOffset = 0;

            try {
                if (szByte >= 0x41 && szByte <= 0x5A) {
                    const size = (szByte - 0x41) + 1;
                    const syncLen = 1;
                    totalLen = syncLen + size;

                    if (packetBufferRef.current.length < totalLen) {
                        return;
                    }

                    opcodeOffset = syncLen + 1;
                    payloadOffset = opcodeOffset + 1;
                    payloadLen = Math.max(0, size - 2);
                } else {
                    if (packetBufferRef.current.length < 6) return;

                    const sizeHex = packetBufferRef.current.slice(1, 5).toString('ascii');
                    if (!/^[0-9A-Fa-f]{4}$/.test(sizeHex)) {
                        console.log('Invalid hex size, dropping byte');
                        packetBufferRef.current = packetBufferRef.current.slice(1);
                        continue;
                    }

                    const size = parseInt(sizeHex, 16);
                    if (size > 65535 || size < 5) {
                        console.log('Invalid packet size, dropping byte');
                        packetBufferRef.current = packetBufferRef.current.slice(1);
                        continue;
                    }

                    const syncLen = 1;
                    const sizeFieldLen = 4;
                    const reservedLen = 1;
                    totalLen = syncLen + size + reservedLen;

                    if (packetBufferRef.current.length < totalLen) {
                        return;
                    }

                    opcodeOffset = syncLen + sizeFieldLen;
                    payloadOffset = opcodeOffset + 1 + reservedLen;
                    payloadLen = Math.max(0, size - sizeFieldLen - 1);
                }

                if (opcodeOffset >= packetBufferRef.current.length ||
                    payloadOffset > packetBufferRef.current.length ||
                    payloadOffset + payloadLen > packetBufferRef.current.length) {
                    console.log('Invalid packet structure, dropping byte');
                    packetBufferRef.current = packetBufferRef.current.slice(1);
                    continue;
                }

                const opcode = String.fromCharCode(packetBufferRef.current[opcodeOffset]);
                const payload = packetBufferRef.current.slice(payloadOffset, payloadOffset + payloadLen);

                console.log(`Parsed packet - Opcode: ${opcode}, Payload length: ${payloadLen}`);

                rxQueueRef.current.push({ opcode, payload: new Uint8Array(payload) });
                packetBufferRef.current = packetBufferRef.current.slice(totalLen);
                packetsProcessed++;

            } catch (parseError) {
                console.log('Packet parsing error:', parseError);
                packetBufferRef.current = packetBufferRef.current.slice(1);
                continue;
            }
        }
    };

    const dequeueIf = (op: string): ParsedPkt | null => {
        const idx = rxQueueRef.current.findIndex(p => p.opcode === op);
        if (idx >= 0) {
            const [pkt] = rxQueueRef.current.splice(idx, 1);
            console.log(`Dequeued packet with opcode: ${op}`);
            return pkt;
        }
        return null;
    };

    const readPacket = async (expectedOpcode: string, timeout = 5000): Promise<Uint8Array> => {
        console.log(`Waiting for packet: ${expectedOpcode}`);
        const start = Date.now();

        while (true) {
            const pkt = dequeueIf(expectedOpcode);
            if (pkt) return pkt.payload;

            const elapsed = Date.now() - start;
            if (elapsed > timeout) {
                const currentQueue = rxQueueRef.current.map(p => p.opcode);
                console.log(`Timeout for ${expectedOpcode}. Queue:`, currentQueue);
                throw new Error(`Timeout waiting for opcode ${expectedOpcode}`);
            }

            await delay(10);
        }
    };

    const writePacket = async (device: Device, opcode: string, payload: string) => {
        const size = 1 + opcode.length + payload.length;
        if (size < 1 || size > 26) {
            throw new Error(`Packet too large for small packet format: ${size}`);
        }
        const sizeChar = String.fromCharCode('A'.charCodeAt(0) + (size - 1));
        const frame = Buffer.from(`*${sizeChar}${opcode}${payload}`, 'utf8');

        console.log(`Sending packet - Opcode: ${opcode}, Payload: ${payload}, Size: ${size}`);

        const isConnected = await device.isConnected();
        if (!isConnected) {
            throw new Error('Device disconnected before packet write');
        }

        try {
            await device.writeCharacteristicWithoutResponseForService(
                VSP_SERVICE_UUID,
                VSP_RX_UUID,
                frame.toString('base64')
            );
            console.log('Packet sent successfully');
        } catch (writeError) {
            console.log('Write error:', writeError);
            throw writeError;
        }
    };

    // RX handler
    const handleRx = (error: any, characteristic: Characteristic | null) => {
        if (error) {
            console.log('RX Error:', error);

            if (error.message && error.message.includes('cancelled')) {
                console.log('Operation cancelled (likely due to disconnect) - ignoring');
                return;
            }

            if (error.message && (error.message.includes('disconnected') || error.message.includes('Device'))) {
                console.log('Device disconnected during communication');
                return;
            } else {
                dispatch({ type: 'SET_ERROR', payload: error.message });
            }
            return;
        }

        if (!characteristic?.value) {
            console.log('Received empty characteristic value');
            return;
        }

        const chunk = Buffer.from(characteristic.value, 'base64');
        console.log('Received chunk:', chunk.toString('hex'));

        packetBufferRef.current = Buffer.concat([packetBufferRef.current, chunk]);
        parsePackets();
    };

    const scanForDevice = async (manager: BleManager, serial: string, msTimeout: number): Promise<Device> => {
        return new Promise<Device>((resolve, reject) => {
            let done = false;

            const stop = () => {
                try {
                    manager.stopDeviceScan();
                    atomicOperations.current.scanInProgress = false;
                } catch { }
            };

            if (immediateCleanupRef.current) {
                return reject(new Error('Scan aborted due to logout cleanup'));
            }

            atomicOperations.current.scanInProgress = true;
            manager.startDeviceScan(null, { allowDuplicates: false }, (err, dev) => {
                if (done) return;
                if (immediateCleanupRef.current) {
                    done = true;
                    stop();
                    return reject(new Error('Scan aborted due to logout cleanup'));
                }
                if (err) {
                    done = true;
                    stop();
                    return reject(err);
                }
                const name = dev?.localName || dev?.name || '';
                if (!name) return;
                console.log(`Found device: ${name}`);
                if (name.startsWith(NAME_FILTER_PREFIX) && name.includes(serial)) {
                    console.log(`Matched target device: ${name}`);
                    done = true;
                    stop();
                    return resolve(dev!);
                }
            });

            setTimeout(() => {
                if (done) return;
                done = true;
                stop();
                reject(new Error('Timeout scanning for device'));
            }, msTimeout);
        });
    };

    const scanForDeviceWithRetry = async (serial: string, isReconnection: boolean, isPeriodicReconnect: boolean): Promise<Device> => {
        const maxScanAttempts = isReconnection ? 2 : 3;
        let scanAttempts = 0;
        let lastScanError: any = null;

        while (scanAttempts < maxScanAttempts) {
            if (immediateCleanupRef.current) {
                throw new Error('Scan retry aborted due to logout cleanup');
            }
            try {
                scanAttempts++;
                console.log(`Scan attempt ${scanAttempts}/${maxScanAttempts}`);

                try {
                    state.manager.stopDeviceScan();
                    atomicOperations.current.scanInProgress = false;
                    await delay(500);
                } catch (stopError) {
                    console.log('Error stopping previous scan:', stopError);
                }

                if (immediateCleanupRef.current) {
                    throw new Error('Scan retry aborted due to logout cleanup');
                }

                const device = await scanForDevice(state.manager, serial, CONFIG.SCAN_TIMEOUT);
                console.log('Device found:', device.name, 'ID:', device.id);
                return device;

            } catch (scanError) {
                lastScanError = scanError;
                console.log(`Scan attempt ${scanAttempts} failed:`, scanError);

                if (scanAttempts >= maxScanAttempts) {
                    throw new Error(`Failed to find device after ${maxScanAttempts} attempts: ${scanError}`);
                }

                const backoffDelay = scanAttempts * 2000;
                console.log(`Waiting ${backoffDelay}ms before next scan attempt`);
                for (let i = 0; i < backoffDelay / 100; i++) {
                    if (immediateCleanupRef.current) {
                        throw new Error('Scan retry aborted due to logout cleanup');
                    }
                    await delay(100);
                }
            }
        }

        throw lastScanError || new Error('Device not found after all scan attempts');
    };

    // Connection management
    const connectWithProperCleanup = async (device: Device, isPeriodicReconnect: boolean) => {
        const maxConnectionAttempts = 2;
        let connectionAttempts = 0;
        let lastConnectionError: any = null;

        while (connectionAttempts < maxConnectionAttempts) {
            if (immediateCleanupRef.current) {
                throw new Error('Connection aborted due to logout cleanup');
            }
            try {
                connectionAttempts++;
                console.log(`Connection attempt ${connectionAttempts}/${maxConnectionAttempts}`);

                try {
                    const isAlreadyConnected = await device.isConnected();
                    if (isAlreadyConnected) {
                        console.log('Device shows already connected, forcing disconnect');
                        await device.cancelConnection();
                        if (immediateCleanupRef.current) {
                            throw new Error('Connection aborted due to logout cleanup');
                        }
                        await delay(2000);
                    }
                } catch (statusError) {
                    console.log('Error checking connection status:', statusError);
                }
                if (immediateCleanupRef.current) {
                    throw new Error('Connection aborted due to logout cleanup');
                }

                const connectionPromise = device.connect({
                    requestMTU: 517,
                    autoConnect: false,
                    timeout: CONFIG.CONNECTION_TIMEOUT
                });

                await Promise.race([
                    connectionPromise,
                    new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(new Error(`Connection timeout after ${CONFIG.CONNECTION_TIMEOUT}ms`));
                        }, CONFIG.CONNECTION_TIMEOUT);
                    })
                ]);

                const isNowConnected = await device.isConnected();
                if (!isNowConnected) {
                    throw new Error('Connection failed - device not connected after connect() call');
                }

                console.log('BLE connected successfully');
                return;

            } catch (connectionError: any) {
                lastConnectionError = connectionError;
                console.log(`Connection attempt ${connectionAttempts} failed:`, connectionError?.message || connectionError);

                if (connectionError?.message?.includes('cancelled')) {
                    try {
                        await device.cancelConnection();
                        await delay(3000);
                    } catch (cancelError) {
                        console.log('Error during cleanup after cancellation:', cancelError);
                    }
                } else if (connectionAttempts < maxConnectionAttempts) {
                    try {
                        await device.cancelConnection();
                        await delay(2000);
                    } catch (cancelError) {
                        console.log('Error canceling connection:', cancelError);
                    }
                }
            }
        }

        throw lastConnectionError || new Error('Connection failed after all attempts');
    };

    const discoverServicesWithRetry = async (device: Device) => {
        const maxAttempts = 2;
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`Service discovery attempt ${attempts}/${maxAttempts}`);

                const isConnected = await device.isConnected();
                if (!isConnected) {
                    throw new Error('Device disconnected before service discovery');
                }

                const discoveryTimeout = 20000;
                const discoveryPromise = device.discoverAllServicesAndCharacteristics();
                const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Service discovery timeout')), discoveryTimeout)
                );

                await Promise.race([discoveryPromise, timeoutPromise]);

                const services = await device.services();
                const vspService = services.find(s => s.uuid === VSP_SERVICE_UUID.toLowerCase());
                if (!vspService) {
                    throw new Error(`VSP service ${VSP_SERVICE_UUID} not found`);
                }

                console.log('Service discovery completed successfully');
                return;

            } catch (discoveryError) {
                console.log(`Service discovery attempt ${attempts} failed:`, discoveryError);

                if (attempts >= maxAttempts) {
                    throw discoveryError;
                }

                await delay(1000);
            }
        }
    };

    const setupDisconnectionHandling = (device: Device) => {
        subscriptionsRef.current.connection = device.onDisconnected((error, disconnectedDevice) => {
            console.log('Device disconnected:', error?.message || 'Unknown reason');

            // Clean up subscriptions
            if (subscriptionsRef.current.rx) {
                subscriptionsRef.current.rx.remove();
                subscriptionsRef.current.rx = null;
            }

            if (subscriptionsRef.current.connection) {
                subscriptionsRef.current.connection.remove();
                subscriptionsRef.current.connection = null;
            }

            packetBufferRef.current = Buffer.alloc(0);
            rxQueueRef.current.length = 0;
            reconnectionInProgressRef.current = false;

            dispatch({ type: 'SET_PERIODIC_RECONNECT', payload: false });

            // Only dispatch disconnect if not already disconnecting
            if (state.connected) {
                dispatch({ type: 'DISCONNECT' });
            }

            // Start periodic reconnect timer only for unexpected disconnections
            // NOT for intentional disconnects
            const isUnexpectedDisconnect = error &&
                !error.message?.includes('cancelled') &&
                !error.message?.includes('Connection was cancelled');

            if (isUnexpectedDisconnect && lastConnectedSerialRef.current &&
                !timersRef.current.periodicReconnect && !immediateCleanupRef.current) {

                console.log('Unexpected disconnect - starting periodic reconnect timer');
                setTimeout(() => {
                    if (!timersRef.current.periodicReconnect &&
                        lastConnectedSerialRef.current &&
                        !immediateCleanupRef.current) {
                        startPeriodicReconnect();
                    }
                }, 5000);
            }
        });
    };


    const setupRxNotifications = async (device: Device) => {
        try {
            subscriptionsRef.current.rx = device.monitorCharacteristicForService(
                VSP_SERVICE_UUID,
                VSP_TX_UUID,
                handleRx
            );
            console.log('RX notifications setup complete');
            await delay(500);
        } catch (rxSetupError) {
            console.log('RX setup failed:', rxSetupError);
            throw new Error(`RX setup failed: ${rxSetupError}`);
        }
    };

    const authenticateWithRetry = async (device: Device, serial: string) => {
        const maxAuthAttempts = 3;
        let authAttempts = 0;
        let authSuccessful = false;

        while (authAttempts < maxAuthAttempts && !authSuccessful) {
            if (immediateCleanupRef.current) {
                throw new Error('Authentication aborted due to logout cleanup');
            }

            try {
                authAttempts++;
                console.log(`Authentication attempt ${authAttempts}/${maxAuthAttempts}`);

                const stillConnected = await device.isConnected();
                if (!stillConnected) {
                    throw new Error('Device disconnected before authentication');
                }

                await writePacket(device, 'A', serial);
                console.log('Authentication packet sent, waiting for response...');

                const authResponse = await readPacket('a', CONFIG.AUTH_TIMEOUT);
                const authResponseStr = Buffer.from(authResponse).toString('utf8');
                console.log('Authentication response:', authResponseStr);

                if (authResponseStr.includes('"Authenticated":true')) {
                    console.log('Authentication successful');
                    dispatch({ type: 'AUTH_SUCCESS' });
                    authSuccessful = true;
                } else {
                    throw new Error(`Authentication failed - invalid response: ${authResponseStr}`);
                }

            } catch (authError: unknown) {
                console.log(`Authentication attempt ${authAttempts} failed:`, authError);

                for (let i = 0; i < 10; i++) {
                    if (immediateCleanupRef.current) {
                        throw new Error('Authentication aborted due to logout cleanup');
                    }
                    await delay(100);
                }
            }
        }
    };

    const concatUint8 = (chunks: Uint8Array[]) => {
        const len = chunks.reduce((a, b) => a + b.length, 0);
        const out = new Uint8Array(len);
        let off = 0;
        for (const c of chunks) {
            out.set(c, off);
            off += c.length;
        }
        return out;
    };

    const parseYYMMDDhhmmss = (name: string): Date | null => {
        const m = name.match(/_(\d{12})\.csv$/);
        if (!m) return null;
        const s = m[1];
        const yy = 2000 + parseInt(s.slice(0, 2), 10);
        const MM = parseInt(s.slice(2, 4), 10) - 1;
        const dd = parseInt(s.slice(4, 6), 10);
        const hh = parseInt(s.slice(6, 8), 10);
        const mm = parseInt(s.slice(8, 10), 10);
        const ss = parseInt(s.slice(10, 12), 10);
        return new Date(Date.UTC(yy, MM, dd, hh, mm, ss));
    };

    const activityTracker = useRef({
        isDownloading: false,
        activeOperations: new Set<string>()
    });


    const scheduleAutoDisconnect = () => {
        if (timersRef.current.autoDisconnect) {
            clearTimeout(timersRef.current.autoDisconnect);
        }

        // Capture device reference NOW
        const deviceRef = state.device;
        const deviceId = state.device?.id;

        console.log(`Scheduling auto-disconnect in ${CONFIG.AUTO_DISCONNECT_DELAY}ms`);
        timersRef.current.autoDisconnect = setTimeout(async () => {
            if (activityTracker.current.isDownloading ||
                activityTracker.current.activeOperations.size > 0 ||
                state.syncingFiles) {
                console.log('Delaying auto-disconnect - active operations detected');
                scheduleAutoDisconnect();
                return;
            }

            console.log('Auto-disconnecting after confirming no active operations');
            await autoDisconnectWithDevice(deviceRef, deviceId);
        }, CONFIG.AUTO_DISCONNECT_DELAY);
    };

    const autoDisconnect = async () => {
        console.log('Auto-disconnecting - ending session properly...');

        // Capture device reference immediately before any async operations
        const deviceToDisconnect = state.device;

        if (!deviceToDisconnect) {
            console.log('No device to disconnect');
            dispatch({ type: 'AUTO_DISCONNECT' });
            return;
        }

        try {
            // Step 1: Remove subscriptions FIRST
            if (subscriptionsRef.current.connection) {
                subscriptionsRef.current.connection.remove();
                subscriptionsRef.current.connection = null;
            }

            if (subscriptionsRef.current.rx) {
                subscriptionsRef.current.rx.remove();
                subscriptionsRef.current.rx = null;
            }

            // Step 2: Send disconnect packet
            console.log('Sending disconnect packet...');
            try {
                await writePacket(deviceToDisconnect, '.', '');
                console.log('Disconnect packet sent successfully');
            } catch (e) {
                console.log('Disconnect packet failed:', e);
            }

            // Step 3: Wait for firmware to process
            await delay(1500);

            // Step 4: Force disconnect using BOTH methods
            console.log('Force disconnecting device...');
            try {
                await deviceToDisconnect.cancelConnection();
                console.log('Device.cancelConnection() called');
            } catch (e) {
                console.log('cancelConnection error:', e);
            }

            await delay(300);

            // Step 5: Manager-level disconnect
            console.log('Manager-level disconnect...');
            try {
                await state.manager.cancelDeviceConnection(deviceToDisconnect.id);
                console.log('Manager disconnect completed');
            } catch (e) {
                console.log('Manager disconnect error:', e);
            }

            console.log('All disconnect operations completed');

        } catch (error) {
            console.log('Critical error during disconnect:', error);
        } finally {
            // Clear everything
            packetBufferRef.current = Buffer.alloc(0);
            rxQueueRef.current.length = 0;
            dispatch({ type: 'AUTO_DISCONNECT' });

            console.log('Disconnect sequence complete - checking LED...');

            // Restart periodic timer
            if (lastConnectedSerialRef.current && !timersRef.current.periodicReconnect && !immediateCleanupRef.current) {
                setTimeout(() => {
                    if (!immediateCleanupRef.current && lastConnectedSerialRef.current && !timersRef.current.periodicReconnect) {
                        startPeriodicReconnect();
                    }
                }, 2000);
            }
        }
    };

    const forceCleanupConnection = async () => {
        try {
            state.manager.stopDeviceScan();
            atomicOperations.current.scanInProgress = false;

            if (subscriptionsRef.current.rx) {
                subscriptionsRef.current.rx.remove();
                subscriptionsRef.current.rx = null;
            }

            if (subscriptionsRef.current.connection) {
                subscriptionsRef.current.connection.remove();
                subscriptionsRef.current.connection = null;
            }

            if (state.device) {
                try {
                    const isConnected = await state.device.isConnected();
                    if (isConnected) {
                        console.log('Disconnecting current device before reconnection');
                        await state.device.cancelConnection();
                    }
                } catch (disconnectError) {
                    console.log('Error during forced disconnect:', disconnectError);
                }
            }

            packetBufferRef.current = Buffer.alloc(0);
            rxQueueRef.current.length = 0;
            await delay(2000);

        } catch (cleanupError) {
            console.log('Error during cleanup:', cleanupError);
        }
    };

    const cleanupFailedConnection = async (device: Device | null) => {
        try {
            console.log('Cleaning up failed connection...');

            try {
                state.manager.stopDeviceScan();
                atomicOperations.current.scanInProgress = false;
            } catch (stopScanError) {
                console.log('Error stopping device scan:', stopScanError);
            }

            if (device) {
                try {
                    const isConnected = await device.isConnected();
                    if (isConnected) {
                        await device.cancelConnection();
                    }
                } catch (cancelError) {
                    console.log('Error canceling connection during cleanup:', cancelError);
                }
            }

            if (subscriptionsRef.current.connection) {
                subscriptionsRef.current.connection.remove();
                subscriptionsRef.current.connection = null;
            }

            if (subscriptionsRef.current.rx) {
                subscriptionsRef.current.rx.remove();
                subscriptionsRef.current.rx = null;
            }

            packetBufferRef.current = Buffer.alloc(0);
            rxQueueRef.current.length = 0;
            await delay(1000);

        } catch (cleanupError) {
            console.log('Error during failed connection cleanup:', cleanupError);
        }
    };


    // Main connect function
    const connect = async (serial: string, isReconnection = false, isPeriodicReconnect = false) => {
        if (immediateCleanupRef.current) {
            throw new Error('Connection aborted due to logout cleanup');
        }
        console.log('Connecting to device with serial:', serial, 'isReconnection:', isReconnection, 'isPeriodicReconnect:', isPeriodicReconnect);

        if (atomicOperations.current.connectionInProgress && !isReconnection && !isPeriodicReconnect) {
            throw new Error('Connection operation already in progress');
        }

        atomicOperations.current.connectionInProgress = true;
        let device: Device | null = null;

        try {
            if (immediateCleanupRef.current) {
                throw new Error('Connection aborted due to logout cleanup');
            }

            if (isPeriodicReconnect) {
                dispatch({ type: 'SET_PERIODIC_RECONNECT', payload: true });
            }

            if ((state.connecting || state.connected || reconnectionInProgressRef.current) &&
                !isReconnection && !isPeriodicReconnect) {
                throw new Error('Connection already in progress or connected');
            }

            reconnectionInProgressRef.current = true;

            // **CRITICAL FIX: Store serial BEFORE connection attempts**
            // This ensures periodic reconnect has access to the serial even if connection fails
            if (!isReconnection && !isPeriodicReconnect) {
                dispatch({ type: 'SET_LAST_SERIAL', payload: serial });
                lastConnectedSerialRef.current = serial; // Explicit ref update
                console.log('Stored serial for future reconnection:', serial);
            }

            if ((isReconnection || isPeriodicReconnect) && state.connected) {
                console.log('Forcing cleanup before reconnection');
                await forceCleanupConnection();
            }

            // Phase 1: Device Search
            if (immediateCleanupRef.current) throw new Error('Connection aborted');
            dispatch({ type: 'SEARCH_START' });
            console.log('Phase 1: Starting device search...');

            device = await scanForDeviceWithRetry(serial, isReconnection, isPeriodicReconnect);
            dispatch({ type: 'SEARCH_SUCCESS' });

            // Phase 2: BLE Connection
            if (immediateCleanupRef.current) throw new Error('Connection aborted');
            dispatch({ type: 'CONNECT_START' });
            await connectWithProperCleanup(device, isPeriodicReconnect);

            // Phase 3: Service Discovery
            if (immediateCleanupRef.current) throw new Error('Connection aborted');
            await discoverServicesWithRetry(device);

            // Phase 4: Setup disconnect monitoring
            if (immediateCleanupRef.current) throw new Error('Connection aborted');
            setupDisconnectionHandling(device);

            // Phase 5: Setup RX notifications
            if (immediateCleanupRef.current) throw new Error('Connection aborted');
            await setupRxNotifications(device);

            // Phase 6: Authentication
            if (immediateCleanupRef.current) throw new Error('Connection aborted');
            dispatch({ type: 'AUTH_START' });
            await authenticateWithRetry(device, serial);

            // Phase 7: Connection Success
            if (immediateCleanupRef.current) throw new Error('Connection aborted');
            dispatch({ type: 'CONNECT_SUCCESS', payload: device });
            await SecureStore.setItemAsync('deckSerial', serial);
            await registerBackgroundTask();

            // Phase 8: File synchronization
            if (immediateCleanupRef.current) throw new Error('Connection aborted');
            if (isPeriodicReconnect) {
                await checkForNewFilesOnly(device);
            } else {
                await performFullFileSync(device);
            }

        } catch (err: any) {
            console.log('Error during connection process:', err);
            await cleanupFailedConnection(device);
            dispatch({ type: 'CONNECT_FAIL', payload: handleError(err, 'Connection') });

            // The serial is now guaranteed to be in lastConnectedSerialRef because we stored it early
            if (lastConnectedSerialRef.current && !immediateCleanupRef.current) {
                console.log('Connection failed - ensuring periodic reconnect is active', {
                    serial: lastConnectedSerialRef.current,
                    isPeriodicReconnect,
                    hasExistingTimer: !!timersRef.current.periodicReconnect
                });

                // Clear any existing timer first to avoid duplicates
                if (timersRef.current.periodicReconnect) {
                    clearInterval(timersRef.current.periodicReconnect);
                    timersRef.current.periodicReconnect = null;
                }

                // Start the timer after a delay
                setTimeout(() => {
                    if (!immediateCleanupRef.current && lastConnectedSerialRef.current) {
                        console.log('Starting periodic reconnect timer after connection failure with serial:', lastConnectedSerialRef.current);
                        startPeriodicReconnect();
                    }
                }, 5000);
            } else {
                console.log('Cannot start periodic reconnect - no serial available');
            }

            throw err;
        }
        finally {
            reconnectionInProgressRef.current = false;
            atomicOperations.current.connectionInProgress = false;
        }
    };


    const downloadFiles = async (deviceOverride?: Device): Promise<FileInfo[] | undefined> => {
        const device = deviceOverride || state.device;
        const connected = deviceOverride ? true : state.connected;

        if (!connected || !device) {
            console.log('Cannot download files - not connected');
            return undefined;
        }

        if (state.syncingFiles) {
            console.log('File sync already in progress, skipping...');
            return undefined;
        }

        activityTracker.current.isDownloading = true;
        const localFileNames = await getLocalFileNames();
        console.log(`Found ${localFileNames.size} local files`);

        const files: FileInfo[] = [];
        let downloadedFiles = 0;

        try {
            console.log('Starting Python-style file download process...');

            if (timersRef.current.autoDisconnect) {
                clearTimeout(timersRef.current.autoDisconnect);
                timersRef.current.autoDisconnect = null;
            }

            await writePacket(device, 'F', '');
            let fileIndex = 0;
            const maxFiles = 25;

            while (fileIndex < maxFiles) {
                let infoBuf: Uint8Array;
                try {
                    infoBuf = await readPacket('F', 8000);
                } catch (error) {
                    const maybeE = dequeueIf('E');
                    if (maybeE) {
                        console.log('No more files to check (E packet received)');
                        break;
                    }
                    console.log('No file info response - stopping');
                    break;
                }

                if (!(await device.isConnected())) {
                    console.log('Connection lost during file processing');
                    break;
                }

                const infoStr = Buffer.from(infoBuf).toString('utf8');
                let info: any;
                try {
                    info = JSON.parse(infoStr);
                } catch (parseError) {
                    console.log('Failed to parse file info JSON:', parseError);
                    await writePacket(device, 'N', '');
                    fileIndex++;
                    continue;
                }

                const fileName: string = info.FileName;
                const sizeEst: number = info.FileSizeEstimate ?? 0;
                const ts = parseYYMMDDhhmmss(fileName);

                // Skip old files (> 72 hours)
                if (!ts || (Date.now() - ts.getTime()) > 72 * 3600 * 1000) {
                    console.log(`Skipping old file: ${fileName}`);
                    await writePacket(device, 'N', '');
                    fileIndex++;
                    continue;
                }

                // Fast skip if file exists locally
                if (localFileNames.has(fileName)) {
                    console.log(`File exists locally, skipping: ${fileName}`);
                    files.push({ fileName, size: sizeEst, timestamp: ts });
                    await writePacket(device, 'N', '');
                    fileIndex++;
                    continue;
                }

                // Download this file using Python-style approach
                console.log(`Downloading new file: ${fileName}`);
                if (!state.isPeriodicReconnect) {
                    debouncedStatusUpdate(`Downloading ${fileName}...`);
                }

                try {
                    // PYTHON-STYLE FILE DOWNLOAD - KEY CHANGE HERE
                    const fileData = await downloadFilePythonStyle(device, fileName, sizeEst);

                    if (fileData && fileData.length > 0) {
                        // Process the complete file data
                        try {
                            const compressed = concatUint8(fileData);
                            console.log(`Decompressing ${compressed.length} bytes for ${fileName}`);

                            const decoder = new HeatshrinkDecoder(10, 5, 64);
                            decoder.process(compressed);
                            const decompressed = decoder.getOutput();
                            const csv = Buffer.from(decompressed).toString('utf8');

                            await storeFile(fileName, csv);

                            files.push({
                                fileName,
                                size: sizeEst,
                                timestamp: ts || new Date()
                            });
                            downloadedFiles++;
                            console.log(`File stored successfully: ${fileName} (${downloadedFiles} downloaded)`);

                        } catch (processingError) {
                            console.log(`Error processing file ${fileName}:`, processingError);
                        }
                    } else {
                        console.log(`No data received for file: ${fileName}`);
                    }

                } catch (fileError) {
                    console.log(`File download failed for ${fileName}:`, fileError);
                }

                // Request next file
                try {
                    await writePacket(device, 'N', '');
                } catch (nextError) {
                    console.log('Error sending next packet request:', nextError);
                    break;
                }

                fileIndex++;
                await delay(50); // Small delay between files
            }

            // Add remaining local files
            const localFiles = await getStoredFiles();
            const deviceFileNames = new Set(files.map(f => f.fileName));

            localFiles.forEach(localFile => {
                if (!deviceFileNames.has(localFile.fileName)) {
                    files.push(localFile);
                }
            });

            console.log(`Python-style file sync complete: ${downloadedFiles} downloaded, ${files.length} total files`);
            return files;

        } catch (e: any) {
            console.log('Critical error during file download:', e);
            handleError(e, 'File download');
            throw e;
        } finally {
            activityTracker.current.isDownloading = false;
        }
    };

    // NEW FUNCTION: Python-style file download that matches the Python protocol exactly
    const downloadFilePythonStyle = async (
        device: Device,
        fileName: string,
        estimatedSize: number
    ): Promise<Uint8Array[]> => {
        const chunks: Uint8Array[] = [];
        let readAttempts = 0;
        const maxReadAttempts = 2000; // Reasonable upper limit

        // Adaptive timeout based on file size (but much shorter than before)
        const getTimeout = (consecutiveFailures: number) => {
            let baseTimeout = 4000; // Start with 4 seconds (like Python)

            if (estimatedSize > 100000) {
                baseTimeout = 6000; // 6 seconds for large files
            }

            // Increase timeout slightly after failures
            if (consecutiveFailures > 0) {
                baseTimeout += (consecutiveFailures * 1000); // +1s per failure
            }

            return Math.min(baseTimeout, 12000); // Cap at 12 seconds max
        };

        let consecutiveTimeouts = 0;
        const maxConsecutiveTimeouts = 8; // Increased for large files

        console.log(`Starting Python-style download for ${fileName} (estimated: ${estimatedSize} bytes)`);

        while (readAttempts < maxReadAttempts && consecutiveTimeouts < maxConsecutiveTimeouts) {
            try {
                // CRITICAL: This matches Python's approach exactly
                // Python sends 'K' (or 'R') for each chunk request
                await writePacket(device, 'K', '');

                const currentTimeout = getTimeout(consecutiveTimeouts);

                // Wait for single 'D' response (like Python does)
                const chunk = await readPacket('D', currentTimeout);

                if (chunk.length === 0) {
                    // Empty response means file transfer complete (like Python)
                    console.log(`File transfer complete after ${readAttempts} read operations`);
                    break;
                }

                chunks.push(chunk);
                readAttempts++;
                consecutiveTimeouts = 0; // Reset failure counter on success

                // Progress indicator (less frequent to avoid spam)
                if (readAttempts % 100 === 0 && !state.isPeriodicReconnect) {
                    console.log(`Downloaded ${readAttempts} chunks for ${fileName}`);
                    debouncedStatusUpdate(`Downloading ${fileName}... (${readAttempts} chunks)`);
                }

                // Small delay to prevent overwhelming the device (like Python's I/O delay)
                await delay(5);

            } catch (readError) {
                consecutiveTimeouts++;
                console.log(`Read attempt ${readAttempts} failed (${consecutiveTimeouts}/${maxConsecutiveTimeouts}): ${readError}`);

                // If we have some data and hit failures, consider it complete
                if (chunks.length > 10 && consecutiveTimeouts >= maxConsecutiveTimeouts) {
                    console.log(`Using partial data: ${chunks.length} chunks received`);
                    break;
                }

                // Brief delay before retry
                await delay(200);
            }
        }

        if (chunks.length === 0) {
            console.log(`No data received for ${fileName} after ${readAttempts} attempts`);
        } else {
            console.log(`Download complete: ${chunks.length} chunks, ${readAttempts} total read operations`);
        }

        return chunks;
    };

    // Also update your downloadNewFilesOnly function similarly
    const downloadNewFilesOnly = async (device: Device): Promise<FileInfo[] | undefined> => {
        activityTracker.current.isDownloading = true;

        try {
            const localFileNames = await getLocalFileNames();
            console.log(`Checking against ${localFileNames.size} local files for new files only`);

            const newFiles: FileInfo[] = [];
            let fileIndex = 0;

            console.log('Checking for new files with Python-style protocol...');
            await writePacket(device, 'F', '');

            // Quick check for immediate E response
            await delay(100);
            const immediateE = dequeueIf('E');
            if (immediateE) {
                console.log('No files available (immediate E response)');
                return newFiles;
            }

            const maxFiles = 20;
            while (fileIndex < maxFiles) {
                let infoBuf: Uint8Array;
                try {
                    infoBuf = await readPacket('F', 6000);
                } catch (error) {
                    const maybeE = dequeueIf('E');
                    if (maybeE) {
                        console.log('No more files to check (E packet received)');
                        break;
                    }
                    console.log('No more files to check (timeout)');
                    break;
                }

                const infoStr = Buffer.from(infoBuf).toString('utf8');
                let info: any;
                try {
                    info = JSON.parse(infoStr);
                } catch (parseError) {
                    console.log('Failed to parse file info, stopping');
                    break;
                }

                const fileName: string = info.FileName;
                const sizeEst: number = info.FileSizeEstimate ?? 0;

                if (localFileNames.has(fileName)) {
                    console.log(`File exists locally, skipping: ${fileName}`);
                    await writePacket(device, 'N', '');
                    fileIndex++;
                    continue;
                }

                const ts = parseYYMMDDhhmmss(fileName);
                if (!ts || (Date.now() - ts.getTime()) > 48 * 3600 * 1000) {
                    console.log(`Old file, skipping: ${fileName}`);
                    await writePacket(device, 'N', '');
                    fileIndex++;
                    continue;
                }

                console.log(`Downloading new file: ${fileName}`);

                // Use the same Python-style download
                const fileData = await downloadFilePythonStyle(device, fileName, sizeEst);

                if (fileData && fileData.length > 0) {
                    const compressed = concatUint8(fileData);
                    const decoder = new HeatshrinkDecoder(10, 5, 64);
                    decoder.process(compressed);
                    const decompressed = decoder.getOutput();
                    const csv = Buffer.from(decompressed).toString('utf8');

                    await storeFile(fileName, csv);
                    newFiles.push({ fileName, size: sizeEst, timestamp: ts });
                    console.log(`New file downloaded: ${fileName} (${fileData.length} chunks)`);
                }

                await writePacket(device, 'N', '');
                fileIndex++;
                await delay(50);
            }

            console.log(`New files check complete: ${newFiles.length} new files found`);
            return newFiles;

        } catch (error) {
            console.log('Error checking for new files:', error);
            return [];
        } finally {
            activityTracker.current.isDownloading = false;
        }
    };


    const checkForNewFilesOnly = async (device: Device) => {
        try {
            console.log('Checking for new files only with optimized logic...');

            if (timersRef.current.autoDisconnect) {
                clearTimeout(timersRef.current.autoDisconnect);
                timersRef.current.autoDisconnect = null;
            }

            const newFiles = await downloadNewFilesOnly(device);
            if (newFiles && newFiles.length > 0) {
                const existingFileNames = new Set(state.files.map(f => f.fileName));
                const uniqueNewFiles = newFiles.filter(f => !existingFileNames.has(f.fileName));
                const allFiles = [...state.files, ...uniqueNewFiles];
                dispatch({ type: 'SYNC_SUCCESS', payload: allFiles });
                console.log(`Found ${uniqueNewFiles.length} genuinely new files during periodic reconnect`);
            } else {
                dispatch({ type: 'SYNC_SUCCESS', payload: state.files });
                console.log('No new files found during periodic reconnect');
            }

            dispatch({ type: 'SILENT_STATUS_UPDATE', payload: `Connected to ${device.name?.split('-')[1] || 'Deck Unit'}` });
            dispatch({ type: 'INITIAL_SYNC_COMPLETE' });

            console.log('Periodic reconnect file check complete - scheduling auto-disconnect');
            // PASS THE DEVICE PARAMETER HERE, NOT state.device
            scheduleAutoDisconnectFast(device);

        } catch (syncError) {
            console.log('New file check error during periodic reconnect:', syncError);
            dispatch({ type: 'SYNC_SUCCESS', payload: state.files });
            dispatch({ type: 'SILENT_STATUS_UPDATE', payload: `Connected to ${device.name?.split('-')[1] || 'Deck Unit'}` });
            dispatch({ type: 'INITIAL_SYNC_COMPLETE' });

            console.log('Periodic reconnect completed with errors - scheduling auto-disconnect');
            // PASS THE DEVICE PARAMETER HERE TOO
            scheduleAutoDisconnectFast(device);
        }
    };

    const scheduleAutoDisconnectWithRef = (deviceRef: Device) => {
        if (timersRef.current.autoDisconnect) {
            clearTimeout(timersRef.current.autoDisconnect);
        }

        const deviceId = deviceRef?.id;
        const fastDelay = CONFIG.AUTO_DISCONNECT_DELAY / 2;

        console.log(`Scheduling fast auto-disconnect with device ref in ${fastDelay}ms`);

        timersRef.current.autoDisconnect = setTimeout(async () => {
            console.log('Auto-disconnecting after optimized file operations');
            await autoDisconnectWithDevice(deviceRef, deviceId);
        }, fastDelay);
    };


    const scheduleAutoDisconnectFast = (device: Device) => {
        if (timersRef.current.autoDisconnect) {
            clearTimeout(timersRef.current.autoDisconnect);
        }

        // Use the device parameter, not state.device
        const deviceId = device.id;
        const fastDelay = CONFIG.AUTO_DISCONNECT_DELAY / 2;

        console.log(`Scheduling fast auto-disconnect in ${fastDelay}ms with device:`, device.name);

        timersRef.current.autoDisconnect = setTimeout(async () => {
            console.log('Auto-disconnecting after optimized file operations');
            await autoDisconnectWithDevice(device, deviceId);
        }, fastDelay);
    };

    const autoDisconnectWithDevice = async (device: Device | null, deviceId: string | undefined) => {
        console.log('Auto-disconnecting - ending session properly...', { hasDevice: !!device, deviceId });

        if (!device) {
            console.log('No device to disconnect');
            dispatch({ type: 'AUTO_DISCONNECT' });
            return;
        }

        try {
            // Remove subscriptions
            if (subscriptionsRef.current.connection) {
                subscriptionsRef.current.connection.remove();
                subscriptionsRef.current.connection = null;
            }

            if (subscriptionsRef.current.rx) {
                subscriptionsRef.current.rx.remove();
                subscriptionsRef.current.rx = null;
            }

            // Send disconnect packet
            console.log('Sending disconnect packet...');
            try {
                await writePacket(device, '.', '');
                console.log('Disconnect packet sent');
            } catch (e) {
                console.log('Disconnect packet failed:', e);
            }

            await delay(1000);

            // Force disconnect
            console.log('Forcing BLE disconnect...');
            try {
                await device.cancelConnection();
                console.log('Device disconnected');
            } catch (e) {
                console.log('cancelConnection error:', e);
            }

            await delay(300);

            // Manager disconnect
            if (deviceId) {
                try {
                    await state.manager.cancelDeviceConnection(deviceId);
                    console.log('Manager disconnect complete');
                } catch (e) {
                    console.log('Manager disconnect error:', e);
                }
            }

        } catch (error) {
            console.log('Disconnect error:', error);
        } finally {
            packetBufferRef.current = Buffer.alloc(0);
            rxQueueRef.current.length = 0;
            dispatch({ type: 'AUTO_DISCONNECT' });

            console.log('LED should now be OFF');

            if (lastConnectedSerialRef.current && !timersRef.current.periodicReconnect && !immediateCleanupRef.current) {
                setTimeout(() => {
                    if (!immediateCleanupRef.current && lastConnectedSerialRef.current && !timersRef.current.periodicReconnect) {
                        startPeriodicReconnect();
                    }
                }, 2000);
            }
        }
    };


    // In BLEContext.tsx, modify the performFullFileSync function
    const performFullFileSync = async (device: Device) => {
        dispatch({ type: 'SYNC_START' });
        console.log('Starting file download...');

        try {
            // Clean up old files before syncing new ones
            await cleanupOldFiles(2); // 2 days = 48 hours

            const files = await downloadFiles(device);
            dispatch({ type: 'SYNC_SUCCESS', payload: files || [] });
            console.log(`Downloaded ${files?.length || 0} files`);
        } catch (syncError: unknown) {
            console.log('File sync error:', syncError);
            dispatch({ type: 'SYNC_ERROR', payload: getErrorMessage(syncError) });
        }
    };

    const refreshFiles = async (): Promise<void> => {
        if (!state.connected || !state.device) {
            throw new Error('Not connected to device');
        }

        if (state.syncingFiles) {
            console.log('File sync already in progress, skipping...');
            return;
        }

        dispatch({ type: 'SYNC_START' });
        try {
            const files = await downloadFiles(state.device);
            dispatch({ type: 'SYNC_SUCCESS', payload: files || [] });
        } catch (error: any) {
            console.log('File sync failed:', error);
            dispatch({ type: 'SYNC_ERROR', payload: error.message });
            throw error;
        }
    };

    const disconnect = async (isLogout = false) => {
        try {
            if (isLogout) {
                await unregisterBackgroundTask();

                console.log('Performing immediate logout cleanup...');
                console.log('Performing immediate logout cleanup...');
                immediateCleanupRef.current = true;

                // Clear the stored serial immediately
                dispatch({ type: 'SET_LAST_SERIAL', payload: '' });
                lastConnectedSerialRef.current = null;

                // Stop all ongoing operations immediately
                try {
                    state.manager.stopDeviceScan();
                    atomicOperations.current.scanInProgress = false;
                } catch (e) {
                    console.log('Error stopping scan during logout:', e);
                }
            }

            // Clear all timers immediately
            clearAllTimers();

            // Cancel any ongoing connection operations
            if (state.device) {
                try {
                    if (!isLogout) {
                        // Only send disconnect packet if not a logout (to avoid delays)
                        await writePacket(state.device, '.', '').catch(() => { });
                        await delay(500);
                    }

                    await state.device.cancelConnection().catch((err) => {
                        console.log('Force disconnect failed:', err);
                    });
                } catch (e) {
                    console.log('Error during device cleanup:', e);
                }
            }

            // Clean up subscriptions
            if (subscriptionsRef.current.rx) {
                subscriptionsRef.current.rx.remove();
                subscriptionsRef.current.rx = null;
            }

            if (subscriptionsRef.current.connection) {
                subscriptionsRef.current.connection.remove();
                subscriptionsRef.current.connection = null;
            }

            if (subscriptionsRef.current.state) {
                subscriptionsRef.current.state.remove();
                subscriptionsRef.current.state = null;
            }

            // Clear buffers and queues
            packetBufferRef.current = Buffer.alloc(0);
            rxQueueRef.current.length = 0;

            // Reset atomic operations
            atomicOperations.current.connectionInProgress = false;
            reconnectionInProgressRef.current = false;

            if (isLogout) {
                // Use immediate cleanup action for logout
                dispatch({ type: 'IMMEDIATE_CLEANUP' });
            } else {
                // Use regular disconnect for normal disconnection
                dispatch({ type: 'DISCONNECT' });
            }

        } catch (error) {
            console.log('Error during disconnect:', error);

            if (isLogout) {
                // Even if cleanup fails, reset state for logout
                dispatch({ type: 'IMMEDIATE_CLEANUP' });
            }
        } finally {
            if (isLogout) {
                immediateCleanupRef.current = false;
            }
        }
    };

    // Periodic reconnect management
    const performPeriodicReconnect = async (serial: string) => {

        if (immediateCleanupRef.current) {
            console.log('Aborting periodic reconnect - immediate cleanup in progress');
            return;
        }
        console.log('performPeriodicReconnect called with conditions:', {
            connected: state.connected,
            connecting: state.connecting,
            searching: state.searching,
            reconnectionInProgress: reconnectionInProgressRef.current,
            isPeriodicReconnect: state.isPeriodicReconnect,
            immediateCleanup: immediateCleanupRef.current

        });

        if (state.connected ||
            state.connecting ||
            state.searching ||
            reconnectionInProgressRef.current ||
            state.isPeriodicReconnect ||
            immediateCleanupRef.current) {
            console.log('Aborting periodic reconnect - connection state changed or already in progress');
            return;
        }

        try {
            console.log('Performing periodic reconnect to:', serial);
            dispatch({ type: 'SILENT_STATUS_UPDATE', payload: 'Reconnecting...' });
            await connect(serial, false, true);
        } catch (error) {
            console.log('Periodic reconnect failed:', error);
            dispatch({ type: 'SILENT_STATUS_UPDATE', payload: 'Disconnected' });
            dispatch({ type: 'SET_PERIODIC_RECONNECT', payload: false });
            reconnectionInProgressRef.current = false;
            console.log('Periodic reconnect will retry on next timer cycle');

        }
    };
    const startPeriodicReconnect = () => {
        if (immediateCleanupRef.current) {
            console.log('Skipping periodic reconnect setup - cleanup in progress');
            return;
        }

        // Clear existing timer if present
        if (timersRef.current.periodicReconnect) {
            console.log('Clearing existing periodic reconnect timer before starting new one');
            clearInterval(timersRef.current.periodicReconnect);
            timersRef.current.periodicReconnect = null;
        }

        console.log('Starting periodic reconnect timer (foreground/background only)...');
        console.log('Periodic reconnect interval set to:', CONFIG.PERIODIC_RECONNECT_INTERVAL, 'ms');

        timersRef.current.periodicReconnect = setInterval(() => {
            if (immediateCleanupRef.current) {
                console.log('Clearing periodic reconnect timer due to cleanup');
                if (timersRef.current.periodicReconnect) {
                    clearInterval(timersRef.current.periodicReconnect);
                    timersRef.current.periodicReconnect = null;
                }
                return;
            }

            console.log('Periodic reconnect timer fired - checking conditions...', {
                hasSerial: !!lastConnectedSerialRef.current,
                connected: state.connected,
                connecting: state.connecting,
                searching: state.searching,
                reconnectionInProgress: reconnectionInProgressRef.current,
                isPeriodicReconnect: state.isPeriodicReconnect,
                connectionInProgress: atomicOperations.current.connectionInProgress
            });

            if (lastConnectedSerialRef.current &&
                !state.connected &&
                !state.connecting &&
                !state.searching &&
                !reconnectionInProgressRef.current &&
                !state.isPeriodicReconnect &&
                !atomicOperations.current.connectionInProgress &&
                !immediateCleanupRef.current) {

                console.log('✓ All conditions met - Initiating periodic reconnect...');
                dispatch({ type: 'SET_PERIODIC_RECONNECT', payload: true });
                performPeriodicReconnect(lastConnectedSerialRef.current);
            } else {
                console.log('✗ Periodic reconnect conditions not met, will retry on next interval');
            }
        }, CONFIG.PERIODIC_RECONNECT_INTERVAL);

        console.log('✓ Periodic reconnect timer successfully created');
    };

    useEffect(() => {
        const initializeAndStartPeriodicReconnect = async () => {
            try {
                const saved = await SecureStore.getItemAsync('deckSerial');
                if (saved) {
                    console.log('App opened with saved serial:', saved);
                    lastConnectedSerialRef.current = saved;
                    dispatch({ type: 'SET_LAST_SERIAL', payload: saved });

                    // Start periodic reconnect immediately if not connected
                    if (!state.connected && !state.connecting && !timersRef.current.periodicReconnect) {
                        console.log('Starting periodic reconnect on app open');
                        setTimeout(() => {
                            if (!immediateCleanupRef.current && !state.connected) {
                                startPeriodicReconnect();
                            }
                        }, 2000); // Small delay to let app settle
                    }
                }
            } catch (error) {
                console.log('Error loading saved serial:', error);
            }
        };

        initializeAndStartPeriodicReconnect();
    }, []);

    useEffect(() => {
        const initializeSerial = async () => {
            try {
                const saved = await SecureStore.getItemAsync('deckSerial');
                if (saved) {
                    console.log('Initializing with saved serial:', saved);
                    lastConnectedSerialRef.current = saved;
                    dispatch({ type: 'SET_LAST_SERIAL', payload: saved });
                }
            } catch (error) {
                console.log('Error loading saved serial:', error);
            }
        };

        initializeSerial();
    }, []);

    useEffect(() => {
        subscriptionsRef.current.state = state.manager.onStateChange(async (s: BLEPowerState) => {
            if (s === 'PoweredOn') {
                const serial = lastConnectedSerialRef.current;
                if (serial && !state.connected && !state.connecting) {
                    console.log('Auto-connecting with saved serial:', serial);
                    try {
                        dispatch({ type: 'SET_PERIODIC_RECONNECT', payload: true });
                        await connect(serial, false, true);
                    } catch (error) {
                        console.log('Auto-connect failed:', error);
                        if (!timersRef.current.periodicReconnect && !immediateCleanupRef.current) {
                            console.log('Auto-connect failed - starting periodic reconnect timer in 5 seconds');
                            setTimeout(() => {
                                if (!immediateCleanupRef.current && !timersRef.current.periodicReconnect) {
                                    startPeriodicReconnect();
                                }
                            }, 5000);
                        }
                    }
                }
            }
        }, true);
        return () => { subscriptionsRef.current.state?.remove(); };
    }, []);

    useEffect(() => {
        if (state.lastConnectedSerial) {
            lastConnectedSerialRef.current = state.lastConnectedSerial;
            console.log('✓ Updated lastConnectedSerialRef to:', state.lastConnectedSerial);
        } else {
            console.log('⚠ lastConnectedSerial is empty in state');
        }
    }, [state.lastConnectedSerial]);
    useEffect(() => {
        reconnectionInProgressRef.current = state.reconnectionInProgress;
    }, [state.reconnectionInProgress]);

    useEffect(() => {
        if (state.initialSyncComplete && state.connected) {
            // Don't auto-disconnect if actively syncing files
            if (state.syncingFiles) {
                console.log('Delaying auto-disconnect - file sync in progress');
                return;
            }

            if (!timersRef.current.autoDisconnect) {
                if (state.isPeriodicReconnect) {
                    console.log('Periodic reconnect sync complete - extended auto-disconnect will be scheduled by checkForNewFilesOnly');
                } else {
                    console.log('Initial sync complete - scheduling standard auto-disconnect');
                    scheduleAutoDisconnect();
                }
            }
        }
    }, [state.initialSyncComplete, state.connected, state.isPeriodicReconnect, state.syncingFiles]);

    useEffect(() => {
        return () => {
            console.log('BLE Provider cleanup');

            try {
                state.manager.stopDeviceScan();
                atomicOperations.current.scanInProgress = false;
            } catch (e) {
                console.log('Error stopping scan:', e);
            }

            subscriptionsRef.current.rx?.remove?.();
            subscriptionsRef.current.state?.remove?.();
            subscriptionsRef.current.connection?.remove?.();

            clearAllTimers();

            atomicOperations.current.connectionInProgress = false;
            reconnectionInProgressRef.current = false;
        };
    }, []);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', async (nextAppState) => {
            if (nextAppState === 'active') {
                console.log('App came to foreground');
                // Resume normal operation
            } else if (nextAppState === 'background') {
                console.log('App went to background');
                // Background task will handle periodic reconnection
            }
        });

        return () => {
            subscription.remove();
        };
    }, []);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', async (nextAppState) => {
            console.log(`App state changed to: ${nextAppState}`);

            if (nextAppState === 'active') {
                console.log('App came to foreground');

                // Check if we have a saved serial and should start/resume periodic reconnect
                if (lastConnectedSerialRef.current && !state.connected && !state.connecting) {
                    // If no periodic timer exists, start one
                    if (!timersRef.current.periodicReconnect && !immediateCleanupRef.current) {
                        console.log('App reopened - starting periodic reconnect timer');
                        setTimeout(() => {
                            if (!immediateCleanupRef.current && !timersRef.current.periodicReconnect) {
                                startPeriodicReconnect();
                            }
                        }, 2000);
                    }
                }
            } else if (nextAppState === 'background') {
                console.log('App went to background - periodic timer will continue');
                // Timer continues running in background (until OS kills it)
            }
        });

        return () => {
            subscription.remove();
        };
    }, [state.connected, state.connecting]);

    const forceStartPeriodicReconnect = async () => {
        if (immediateCleanupRef.current) {
            console.log('Cannot start periodic reconnect - cleanup in progress');
            return;
        }

        // Get serial from SecureStore if ref is not available
        let serial = lastConnectedSerialRef.current;
        if (!serial) {
            try {
                serial = await SecureStore.getItemAsync('deckSerial');
                if (serial) {
                    console.log('Retrieved serial from SecureStore:', serial);
                    // Update the ref for future use
                    lastConnectedSerialRef.current = serial;
                    dispatch({ type: 'SET_LAST_SERIAL', payload: serial });
                }
            } catch (error) {
                console.log('Error retrieving serial from SecureStore:', error);
            }
        }

        if (!serial) {
            console.log('Cannot start periodic reconnect - no saved serial');
            return;
        }

        if (state.connected ||
            state.connecting ||
            state.searching ||
            reconnectionInProgressRef.current ||
            state.isPeriodicReconnect) {
            console.log('Periodic reconnect already active or connection in progress');
            return;
        }

        console.log('Force starting periodic reconnect immediately with serial:', serial);
        dispatch({ type: 'SET_PERIODIC_RECONNECT', payload: true });
        performPeriodicReconnect(serial);
    };

    const registerBackgroundTask = async () => {
        try {
            const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_RECONNECT_TASK);

            if (!isRegistered) {
                await BackgroundFetch.registerTaskAsync(BACKGROUND_RECONNECT_TASK, {
                    minimumInterval: 10 * 60, // 10 minutes in seconds
                    stopOnTerminate: false, // Continue after app is closed
                    startOnBoot: true, // Start on device boot
                });
                console.log('Background task registered successfully');
            }
        } catch (error) {
            console.log('Failed to register background task:', error);
        }
    };

    const unregisterBackgroundTask = async () => {
        try {
            await BackgroundFetch.unregisterTaskAsync(BACKGROUND_RECONNECT_TASK);
            console.log('Background task unregistered');
        } catch (error) {
            console.log('Failed to unregister background task:', error);
        }
    };

    return (
        <BLEContext.Provider value={{
            state,
            connect,
            downloadFiles,
            refreshFiles,
            disconnect,
            forceStartPeriodicReconnect
        }}>
            {children}
        </BLEContext.Provider>
    );
};

export const useBLE = (): Ctx => {
    const ctx = useContext(BLEContext);
    if (!ctx) throw new Error('useBLE must be used within a BLEProvider');
    return ctx;
}