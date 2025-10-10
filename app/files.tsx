import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, Image, Alert, Linking, Platform, Animated } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useBLE } from '@/src/context/BLEContext';
import { getStoredFiles, getFileContent } from '@/src/service/DataService';
import CommonHeader from './component/CommonHeader';
import TechnicalSupport from './component/TechnicalSupport';
import ErrorPopup from './component/ErrorPopup';
import { useFocusEffect } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import * as IntentLauncher from 'expo-intent-launcher';



const FileListScreen = () => {
    const router = useRouter();
    const { state, disconnect, refreshFiles, forceStartPeriodicReconnect } = useBLE();
    const [localFiles, setLocalFiles] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [navigating, setNavigating] = useState(false);
    const [isSupportVisible, setSupportVisible] = useState(false);
    const [showErrorPopup, setShowErrorPopup] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const screenActiveRef = useRef(true);
    const [lastConnectedDevice, setLastConnectedDevice] = useState<string>('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showScrollIndicator, setShowScrollIndicator] = useState(false);
    const scrollPosition = useRef(new Animated.Value(0)).current;
    const [trackHeight, setTrackHeight] = useState(0);


    useFocusEffect(
        React.useCallback(() => {
            console.log('FileListScreen focused');
            screenActiveRef.current = true;
            setNavigating(false);

            return () => {
                console.log('FileListScreen blurred');
                screenActiveRef.current = false;
            };
        }, [])
    );

    useEffect(() => {
        loadStoredFiles();
    }, []);

    useEffect(() => {
        if (state?.files.length > 0) {
            loadStoredFiles();
        }
    }, [state?.files]);

    useEffect(() => {
        // Set isRefreshing to true when any connection activity starts
        if (state?.connecting || state?.searching || state?.authenticating) {
            setIsRefreshing(true);
        }
        // Set isRefreshing to false when connected or all activities stop
        else if (state?.connected || (!state?.connecting && !state?.searching && !state?.authenticating)) {
            setIsRefreshing(false);
        }
    }, [state?.connecting, state?.searching, state?.authenticating, state?.connected]);


    useEffect(() => {
        const isInitialLoading = (state?.connecting || state?.searching || state?.authenticating) &&
            !state?.initialSyncComplete &&
            !state?.isPeriodicReconnect;

        const isInitialSync = state?.syncingFiles && !state?.initialSyncComplete && !state?.isPeriodicReconnect;

        if (!isInitialLoading && !isInitialSync) {
            setLoading(false);
        }
    }, [state?.syncingFiles, state?.connecting, state?.searching, state?.authenticating, state?.initialSyncComplete, state?.isPeriodicReconnect]);

    // Handle errors but not for periodic reconnects
    useEffect(() => {
        if (state?.error &&
            (state?.error.includes('File sync failed') || state?.error.includes('sync')) &&
            !state?.isPeriodicReconnect) {
            setErrorMessage(`File sync failed: ${state?.error}`);
            setShowErrorPopup(true);
            setLoading(false);
        }
    }, [state?.error, state?.isPeriodicReconnect]);

    useEffect(() => {
        const saveDeviceId = async (deviceId: string) => {
            try {
                await SecureStore.setItemAsync('lastConnectedDeckUnit', deviceId);
            } catch (error) {
                console.log('Error saving device ID:', error);
            }
        };

        if (state?.connected && state?.device?.name) {
            const deviceSerial = state.device.name.split('-')[1];
            if (deviceSerial && deviceSerial !== lastConnectedDevice) {
                setLastConnectedDevice(deviceSerial);
                saveDeviceId(deviceSerial);
            }
        }
    }, [state?.connected, state?.device?.name]);

    useEffect(() => {
        const loadSavedDeviceId = async () => {
            try {
                const savedDeviceId = await SecureStore.getItemAsync('lastConnectedDeckUnit');
                if (savedDeviceId) {
                    setLastConnectedDevice(savedDeviceId);
                }
            } catch (error) {
                console.log('Error loading saved device ID:', error);
            }
        };
        loadSavedDeviceId();
    }, []);

    const startFileSync = async () => {
        try {
            setIsRefreshing(true);
            setLoading(true);
            await refreshFiles();
        } catch (error: any) {
            console.log('File sync error:', error);
        } finally {
            setIsRefreshing(false);
        }
    };


    const handleStartConnection = async (): Promise<void> => {
        if (canStartConnection()) {
            const bluetoothState = await state.manager.state();
            if (bluetoothState !== 'PoweredOn') {
                setErrorMessage('Bluetooth is not enabled. Please turn it on in Settings.');
                setShowErrorPopup(true);
                return;
            }

            forceStartPeriodicReconnect();
            // Don't manually set isRefreshing here - let useEffect handle it
        }
    };

    const handleErrorPopupButtonPress = (): void => {
        setShowErrorPopup(false);
        const currentErrorMessage = errorMessage;
        setErrorMessage('');

        // Navigate to Bluetooth settings if it's a Bluetooth error
        if (currentErrorMessage.includes('Bluetooth')) {
            openBluetoothSettings();
        }
    };

    const handleScroll = (event: any) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const isScrollable = contentSize.height > layoutMeasurement.height;

        if (!isScrollable) {
            setShowScrollIndicator(false);
            return;
        }

        setShowScrollIndicator(true);

        const maxScroll = contentSize.height - layoutMeasurement.height;
        const scrollPercentage = Math.max(0, Math.min(1, contentOffset.y / maxScroll));

        // Smooth animation with native driver for 60fps performance
        Animated.timing(scrollPosition, {
            toValue: scrollPercentage,
            duration: 0, // Instant, no lag
            useNativeDriver: true,
        }).start();
    };

    const openBluetoothSettings = (): void => {
        if (Platform.OS === 'android') {
            IntentLauncher.startActivityAsync(
                IntentLauncher.ActivityAction.BLUETOOTH_SETTINGS
            );
        } else {
            Linking.openSettings();
        }
    };

    const canStartConnection = () => {
        return !state?.connected &&
            !state?.connecting &&
            !state?.searching &&
            !state?.authenticating &&
            !state?.isPeriodicReconnect;  // Keep this to prevent double-triggering
    };

    const getConnectionButtonText = () => {
        if (state?.connected) {
            return 'Connected';
        } else if (state?.searching) {
            return 'Looking for device...';
        } else if (state?.connecting) {
            return 'Connecting...';
        } else if (state?.authenticating) {
            return 'Authenticating...';
        }
        return 'Refresh';
    };

    const loadStoredFiles = async () => {
        try {
            const storedFiles = await getStoredFiles();

            const fileMap = new Map();

            state?.files.forEach(file => {
                fileMap.set(file.fileName, file);
            });

            storedFiles.forEach(file => {
                if (!fileMap.has(file.fileName)) {
                    fileMap.set(file.fileName, file);
                }
            });

            const allFiles = Array.from(fileMap.values())
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            setLocalFiles(allFiles);
            if (!loading) setLoading(false);
        } catch (error) {
            console.log('Error loading files:', error);
            setLocalFiles([]);
            setLoading(false);
        }
    };

    const formatFileSize = (size: number) => {
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    };

    const getSensorIdFromFileName = (fileName: string) => {
        const sensorMatch = fileName.match(/MOANA_(\d+)_/);
        return sensorMatch ? `#${sensorMatch[1]}` : '';
    };

    const getCleanFileName = (fileName: string) => {
        // Remove MOANA_XXXX_ part and .csv extension
        return fileName.replace(/MOANA_\d+_/, '').replace('.csv', '');
    };


    const formatTimestamp = (timestamp: Date | string) => {
        const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
        return date.toLocaleString('en-GB', {  // Changed from 'en-US' to 'en-GB' for dd/mm/yyyy format
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(',', '');
    };

    const handleFilePress = async (item: any) => {
        try {
            setNavigating(true);
            const content = await getFileContent(item.fileName);
            if (content) {
                router.push({
                    pathname: '/visualization',
                    params: {
                        fileName: item.fileName,
                        content: content,
                        preserveConnection: 'true'
                    }
                });
            } else {
                Alert.alert('Error', 'Could not load file content');
                setNavigating(false);
            }
        } catch (error) {
            console.log('Error loading file:', error);
            Alert.alert('Error', 'Failed to load file');
            setNavigating(false);
        }
    };

    const handleSupportToggle = (isVisible: boolean) => {
        setSupportVisible(isVisible);
    };

    const handleBackToFiles = () => {
        setSupportVisible(false);
    };

    const handleErrorPopupClose = () => {
        setShowErrorPopup(false);
        setErrorMessage('');
    };

    const handleRetrySync = async () => {
        setShowErrorPopup(false);
        setErrorMessage('');
        await startFileSync();
    };
    const handleLogout = async () => {
        try {
            console.log('User initiated logout - performing immediate cleanup');

            // Clear saved serial and device ID from secure store
            await SecureStore.deleteItemAsync('deckSerial');
            await SecureStore.deleteItemAsync('lastConnectedDeckUnit');

            // Clear local state
            setLastConnectedDevice('');

            // Disconnect from device with immediate cleanup flag
            await disconnect(true);

            // Navigate back to home screen
            router.push('/');

            console.log('Logout completed successfully');

        } catch (error) {
            console.log('Error during logout:', error);
            router.push('/');
        }
    };

    const getConnectionStatus = () => {
        if (lastConnectedDevice) {
            return `Zebratech Deck Unit ${lastConnectedDevice}`;
        } else if (state?.connected) {
            const deviceSerial = state?.device?.name?.split('-')[1] || 'Deck Unit';
            return `Zebratech Deck Unit ${deviceSerial}`;
        } else {
            return 'No Deck Unit Connected';
        }
    };

    const getConnectionSubStatus = () => {
        if (state?.connected) {
            return 'Connected';
        } else if (state?.searching) {
            return 'Looking for device...';
        } else if (state?.connecting) {
            return 'Connecting...';
        } else if (state?.authenticating) {
            return 'Authenticating...';
        }
        return '';
    };
    const getConnectionStatusColor = () => {
        return '#0B5FAF';
    };

    const getSubStatusColor = () => {
        if (state?.connected) {
            return '#28a745';
        } else if (state?.searching || state?.connecting || state?.authenticating) {
            return '#ff9800';
        } else if (state?.isPeriodicReconnect && (state?.connecting || state?.searching || state?.authenticating)) {
            return '#ffc107';
        } else {
            return '#6c757d';
        }
    };

    // Show connection indicator for periodic reconnects
    const ConnectionIndicator = () => {
        if (state?.isPeriodicReconnect && (state?.connecting || state?.searching || state?.authenticating)) {
            return (
                <View style={styles.connectionIndicator}>
                    {/* <View style={styles.pulsingDot} /> */}
                </View>
            );
        }
        return null;
    };

    const FileItem = ({ item }: { item: any }) => (
        <TouchableOpacity
            style={styles.fileRow}
            activeOpacity={0.7}
            onPress={() => handleFilePress(item)}
        >
            {/* <MaterialCommunityIcons name="file-document" size={38} color="#4188C3FF" style={styles.fileIcon} /> */}
            <View style={styles.fileInfo}>
                <Text style={[styles.cellText, styles.fileNameText, styles.blueText]} numberOfLines={1}>
                    {getCleanFileName(item.fileName)}
                </Text>
                <Text style={[styles.cellText, styles.sensorDateText]} numberOfLines={1}>
                    {getSensorIdFromFileName(item.fileName)} • {formatTimestamp(item.timestamp)}
                </Text>
            </View>
            <Text style={[styles.cellText, styles.sizeText]} numberOfLines={1}>
                {formatFileSize(item.size || 0)}
            </Text>
        </TouchableOpacity>
    );



    // Only show initial loading screen for first connection, not periodic reconnects
    const isInitialLoading = (state?.connecting || state?.searching || state?.authenticating || state?.syncingFiles) &&
        !state?.initialSyncComplete &&
        !state?.isPeriodicReconnect &&
        localFiles.length === 0;

    if (isInitialLoading) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <StatusBar style="light" />
                <CommonHeader
                    onSupportToggle={handleSupportToggle}
                    showLogout={true}
                    onLogout={handleLogout}
                    isOnSupportScreen={isSupportVisible}
                />
                <View style={styles.loadingContainer}>
                    <Image
                        source={require('@/assets/images/Loading.gif')}
                        style={styles.loader}
                    />
                    <Text style={styles.loadingText}>
                        {state?.statusMessage ? state?.statusMessage : 'Loading files...'}
                    </Text>
                </View>
                <ErrorPopup
                    visible={showErrorPopup}
                    title="File Sync Error"
                    message={errorMessage}
                    buttonText="Retry"
                    onClose={handleErrorPopupClose}
                    onButtonPress={handleRetrySync}
                />
            </SafeAreaView>
        );
    }

    if (navigating) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <StatusBar style="light" />
                <CommonHeader
                    onSupportToggle={handleSupportToggle}
                    showLogout={true}
                    onLogout={handleLogout}
                />
                <View style={styles.loadingContainer}>
                    <Image
                        source={require('@/assets/images/Loading.gif')}
                        style={styles.loader}
                    />
                    <Text style={styles.loadingText}>
                        Loading visualization...
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar style="light" />
            <CommonHeader
                onSupportToggle={handleSupportToggle}
                showLogout={true}
                onLogout={handleLogout}
            />

            <View style={styles.screenContainer}>
                {isSupportVisible ? (
                    <TechnicalSupport onBack={handleBackToFiles} />
                ) : (
                    <>
                        <View style={styles.cardWrapper}>
                            <View style={styles.contentCard}>
                                {/* Enhanced Header with Connection Status */}
                                <View style={styles.cardHeader}>
                                    <Text style={styles.vesselText}>Files:</Text>

                                    <View style={styles.connectionStatusContainer}>
                                        <Text style={[
                                            styles.infoText,
                                            { color: getConnectionStatusColor() }
                                        ]}>
                                            {getConnectionStatus()}
                                        </Text>
                                        <Text style={[
                                            styles.subStatusText,
                                            { color: getSubStatusColor() }
                                        ]}>
                                            {getConnectionSubStatus()}
                                        </Text>
                                        <ConnectionIndicator />
                                    </View>
                                    {/* 
                                    {state?.isPeriodicReconnect && state?.syncingFiles && (
                                        <Text style={styles.syncingIndicator}>
                                            Checking for new files...
                                        </Text>
                                    )} */}
                                </View>

                                {/* File List section inside the card */}
                                <View style={styles.fileListContainer}>
                                    {localFiles.length === 0 ? (
                                        <View style={styles.noFilesContainer}>
                                            <MaterialCommunityIcons name="file-outline" size={48} color="#CCC" />
                                            <Text style={styles.noFilesText}>No files available</Text>
                                            <Text style={styles.noFilesSubtext}>
                                                {state?.connected ? 'Try refreshing or check device' : 'Device will auto-reconnect periodically'}
                                            </Text>
                                        </View>
                                    ) : (
                                        <FlatList
                                            data={localFiles}
                                            renderItem={({ item }) => <FileItem item={item} />}
                                            keyExtractor={(item, index) => `${item.fileName}-${index}`}
                                            ItemSeparatorComponent={() => <View style={styles.separator} />}
                                            contentContainerStyle={styles.listContent}
                                            showsVerticalScrollIndicator={false}
                                            scrollIndicatorInsets={{ right: 1 }}
                                            onScroll={handleScroll}
                                            scrollEventThrottle={16}
                                        />

                                    )}
                                    {showScrollIndicator && (
                                        <View
                                            style={styles.scrollIndicatorTrack}
                                            onLayout={(event) => {
                                                const { height } = event.nativeEvent.layout;
                                                setTrackHeight(height);
                                            }}
                                        >
                                            <Animated.View
                                                style={[
                                                    styles.scrollIndicatorThumb,
                                                    {
                                                        transform: [{
                                                            translateY: trackHeight > 0
                                                                ? scrollPosition.interpolate({
                                                                    inputRange: [0, 1],
                                                                    outputRange: [0, trackHeight - 50],
                                                                    extrapolate: 'clamp'
                                                                })
                                                                : 0
                                                        }]
                                                    }
                                                ]}
                                            />
                                        </View>
                                    )}
                                </View>
                            </View>
                        </View>

                        {/* Start Connection Button - only show if files available */}
                        {localFiles.length > 0 && (
                            <TouchableOpacity
                                style={[
                                    styles.startConnectionButton,
                                    (!canStartConnection() || isRefreshing) && styles.startConnectionButtonDisabled
                                ]}
                                activeOpacity={canStartConnection() && !isRefreshing ? 0.7 : 1}
                                onPress={handleStartConnection}
                                disabled={!canStartConnection() || isRefreshing}
                            >
                                <Text style={[
                                    styles.startConnectionButtonText,
                                    (!canStartConnection() || isRefreshing) && styles.startConnectionButtonTextDisabled
                                ]}>
                                    {getConnectionButtonText()}
                                </Text>
                            </TouchableOpacity>
                        )}
                    </>
                )}

                {/* Bottom Image */}
                <Image
                    source={require('@/assets/images/image_2.png')}
                    style={styles.bottomImage}
                    resizeMode="cover"
                />
            </View>

            <ErrorPopup
                visible={showErrorPopup}
                title="File Sync Error"
                message={errorMessage}
                buttonText={errorMessage.includes('Bluetooth') ? 'Open Settings' : 'Retry'}
                onClose={handleErrorPopupClose}
                onButtonPress={errorMessage.includes('Bluetooth') ? handleErrorPopupButtonPress : handleRetrySync}
            />
        </SafeAreaView>
    );
};
const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F0F2F5',
    },
    connectionStatusContainer: {
        marginBottom: 2,
    },
    subStatusText: {
        fontSize: 14,
        fontWeight: '400',
        marginTop: 1,
    },
    loader: {
        width: 140,
        height: 120,
    },
    loadingText: {
        fontSize: 18,
        color: '#666666',
        marginTop: 20,
        textAlign: 'center',
    },
    safeArea: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    screenContainer: {
        flex: 1,
        backgroundColor: '#F0F2F5',
        justifyContent: 'space-between', // Changed: this keeps button above bottom image
        paddingBottom: 100, // Space for bottom image
    },
    cardWrapper: {
        flex: 1, // Changed: allows card to shrink when needed
        marginHorizontal: 10,
        marginTop: 5,
        marginBottom: 10,
        minHeight: 300, // Minimum height to prevent it from being too small
    },
    blueText: {
        color: '#0B5FAF',
    },
    contentCard: {
        flex: 1, // Changed: card fills available space
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
        overflow: 'hidden',
    },
    scrollIndicatorTrack: {
        position: 'absolute',
        right: 8,
        top: 20,
        bottom: 20,
        width: 6,
        backgroundColor: 'rgba(11, 95, 175, 0.2)',
        borderRadius: 3,
    },
    scrollIndicatorThumb: {
        position: 'absolute',
        top: 0,
        width: 6,
        height: 50,
        backgroundColor: '#0B5FAF',
        borderRadius: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
        elevation: 3,
    },
    cardHeader: {
        paddingHorizontal: 20,
        paddingTop: 15,
        paddingBottom: 5,
        flexShrink: 0,
    },
    connectionStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 5,
    },
    connectionIndicator: {
        marginLeft: 8,
    },
    pulsingDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#ffc107',
        opacity: 0.8,
    },
    vesselText: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#0B5FAF',
        paddingVertical: 5,
    },
    sensorDateText: {
        color: '#777777',
        fontSize: 12,
    },
    infoText: {
        fontSize: 16,
        fontWeight: '500',
        lineHeight: 22,
    },
    startConnectionButton: {
        backgroundColor: '#0B5FAF',
        marginHorizontal: 20,
        marginBottom: 15, // Space above bottom image
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        width: '50%',
        alignSelf: 'center',
    },
    startConnectionButtonDisabled: {
        backgroundColor: '#CCCCCC',
        shadowOpacity: 0,
        elevation: 0,
    },
    startConnectionButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    startConnectionButtonTextDisabled: {
        color: '#888888',
    },
    syncingIndicator: {
        fontSize: 12,
        color: '#ffc107',
        fontStyle: 'italic',
        marginTop: 1,
    },
    fileListContainer: {
        flex: 1,
    },
    listContent: {
        paddingBottom: 10,
        flexGrow: 1,
    },
    fileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
    },
    fileIcon: {
        marginRight: 12,
    },
    fileInfo: {
        flex: 1,
    },
    cellText: {
        fontSize: 13,
        color: '#333333',
    },
    fileNameText: {
        fontWeight: '500',
    },
    timestampText: {
        color: '#555555',
    },
    sizeText: {
        color: '#555555',
        textAlign: 'right',
    },
    separator: {
        height: 1,
        backgroundColor: '#F0F0F0',
    },
    bottomImage: {
        width: '100%',
        height: 100,
        position: 'absolute',
        bottom: 0,
    },
    noFilesContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    noFilesText: {
        fontSize: 18,
        fontWeight: '500',
        color: '#666666',
        marginTop: 16,
        textAlign: 'center',
    },
    noFilesSubtext: {
        fontSize: 14,
        color: '#999999',
        marginTop: 8,
        textAlign: 'center',
    },
}); export default FileListScreen;