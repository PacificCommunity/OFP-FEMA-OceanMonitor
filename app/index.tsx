import React, { useEffect, useState, useCallback } from 'react';
// CHANGED: Added SafeAreaView for better status bar handling
import { StyleSheet, View, TextInput, Text, Image, TouchableOpacity, Platform, Linking, SafeAreaView, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useBLE } from '@/src/context/BLEContext';
import { request, PERMISSIONS, RESULTS, check } from 'react-native-permissions';
import { debounce } from 'lodash';
import { StatusBar } from 'expo-status-bar';
import CommonHeader from './component/CommonHeader';
import ErrorPopup from './component/ErrorPopup';
import TechnicalSupport from './component/TechnicalSupport';
import * as SplashScreen from 'expo-splash-screen';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import { AppState, AppStateStatus } from 'react-native';



export default function HomeScreen() {
  const router = useRouter();
  const { connect, state } = useBLE();
  const [serial, setSerial] = useState('');
  const [showSplash, setShowSplash] = useState(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isSupportVisible, setSupportVisible] = useState(false);
  const [showErrorPopup, setShowErrorPopup] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorPopupPermissionType, setErrorPopupPermissionType] = useState<string | null>(null);
  const [hasSavedSerial, setHasSavedSerial] = useState<boolean | null>(null);
  const [bluetoothStateSubscription, setBluetoothStateSubscription] = useState<any>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);


  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 3000);
    SplashScreen.hideAsync();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const checkSavedSerial = async () => {
      try {
        const savedSerial = await SecureStore.getItemAsync('deckSerial');
        setHasSavedSerial(!!savedSerial);

        if (savedSerial) {
          console.log('Found saved serial, showing splash and navigating to files screen');

          // NEW: Check Bluetooth state before auto-connect
          const bluetoothState = await state.manager.state();

          if (bluetoothState === 'PoweredOn') {
            // Bluetooth is on - trigger connection immediately
            console.log('Bluetooth is on - starting auto-connection');
            try {
              // Start connection before navigation
              connect(savedSerial, false, true).catch(err => {
                console.log('Auto-connect failed:', err);
              });
            } catch (error) {
              console.log('Error during auto-connect:', error);
            }
          } else {
            console.log('Bluetooth is off - will auto-connect when turned on');
          }

          // Navigate to files screen after 3 seconds
          setTimeout(() => {
            router.push('/files');
          }, 3000);
        } else {
          console.log('No saved serial, showing splash then login form');
          setTimeout(() => {
            setShowSplash(false);
          }, 3000);
        }
      } catch (error) {
        console.log('Error checking saved serial:', error);
        setHasSavedSerial(false);
        setTimeout(() => {
          setShowSplash(false);
        }, 3000);
      }
    };

    checkSavedSerial();
  }, []);

  useEffect(() => {
    let subscription: any = null;

    const startBluetoothMonitoring = () => {
      if (state.manager) {
        subscription = state.manager.onStateChange((bluetoothState) => {
          console.log('Bluetooth state changed to:', bluetoothState);

          // If Bluetooth is turned on and we have an error popup showing
          if (bluetoothState === 'PoweredOn' && showErrorPopup) {
            // Check if the error is Bluetooth related
            if (errorMessage.includes('Bluetooth') ||
              errorMessage.includes('bluetooth') ||
              errorPopupPermissionType === 'bluetooth') {
              console.log('Bluetooth is now on, closing error popup');
              setShowErrorPopup(false);
              setErrorMessage('');
              setErrorPopupPermissionType(null);
            }
          }
        }, true);

        setBluetoothStateSubscription(subscription);
      }
    };

    startBluetoothMonitoring();

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [state.manager, showErrorPopup, errorMessage, errorPopupPermissionType]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      console.log('App state changed from', appState, 'to', nextAppState);

      // When app becomes active (user returns from settings)
      if (appState.match(/inactive|background/) && nextAppState === 'active') {
        console.log('App became active, checking Bluetooth state');

        // Check Bluetooth state when returning to app
        if (state.manager && showErrorPopup) {
          state.manager.state().then((bluetoothState) => {
            console.log('Current Bluetooth state:', bluetoothState);

            if (bluetoothState === 'PoweredOn' &&
              (errorMessage.includes('Bluetooth') ||
                errorMessage.includes('bluetooth') ||
                errorPopupPermissionType === 'bluetooth')) {
              console.log('Bluetooth is now on after returning from settings, closing popup');
              setShowErrorPopup(false);
              setErrorMessage('');
              setErrorPopupPermissionType(null);
            }
          });
        }
      }

      setAppState(nextAppState);
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription?.remove();
    };
  }, [appState, state.manager, showErrorPopup, errorMessage, errorPopupPermissionType]);

  // Add cleanup in component unmount (add this useEffect)
  useEffect(() => {
    return () => {
      if (bluetoothStateSubscription) {
        bluetoothStateSubscription.remove();
      }
    };
  }, [bluetoothStateSubscription]);

  useEffect(() => {
    if (state.connected && state.navigationReady && !state.connecting) {
      console.log('Navigation conditions met - navigating to files screen');
      setTimeout(() => {
        router.push('/files');
      }, 100);
    }
  }, [state.connected, state.navigationReady, state.connecting, router]);


  useEffect(() => {
    if (state.error && !state.connecting && !state.connected) {
      console.log('Connection failed, showing error popup');

      // Check if it's a timeout error
      const isTimeoutError = state.error.includes('Timeout') ||
        state.error.includes('timeout') ||
        state.error.includes('scanning for device');

      // Check if it's a location services error - fix the empty string check
      const isLocationServicesError = state.error.includes('Location') ||
        state.error.includes('location') ||
        state.error.includes('ACCESS_FINE_LOCATION');

      // Check if it's a BLE-specific error
      const isBLEError = state.error.includes('BleError') ||
        state.error.includes('disconnected') ||
        state.error.includes('Device') ||
        state.error.includes('Bluetooth');

      if (isTimeoutError) {
        setErrorMessage('Connection timeout! Please check your Deck Unit serial number and try again.');
        setErrorPopupPermissionType(null);
      } else if (isLocationServicesError) {
        setErrorMessage('Location services are disabled. Please enable location services and try again.');
        setErrorPopupPermissionType('location');
      } else if (isBLEError) {
        // For BLE errors, show a generic connection error message
        setErrorMessage('Connection failed! Please check your Deck Unit is powered on and within range, then try again.');
        setErrorPopupPermissionType(null);
      } else {
        // Default case for any other errors
        setErrorMessage(state.error);
        setErrorPopupPermissionType(null);
      }

      setShowErrorPopup(true);
    }
  }, [state.error, state.connecting, state.connected]);

  // Reset support visibility when component mounts
  useEffect(() => {
    setSupportVisible(false);
  }, []);

  const requestBluetoothPermission = async () => {
    try {
      if (Platform.OS === 'android') {
        const androidVersion = Platform.Version as number;

        if (androidVersion >= 31) {
          console.log('Requesting Android 12+ Bluetooth permissions');
          const scanResult = await request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
          const connectResult = await request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);

          if (scanResult === RESULTS.GRANTED && connectResult === RESULTS.GRANTED) {
            console.log('Android 12+ Bluetooth permissions granted');
            setPermissionError(null);
            return { success: true, permissionType: null };
          } else {
            console.log('Android 12+ Bluetooth permissions denied');
            setPermissionError('Bluetooth permissions are required. Please enable them in Settings.');
            return { success: false, permissionType: 'bluetooth' };
          }
        } else { // Android < 12
          console.log('Requesting legacy Android permissions');

          const locationResult = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);

          if (locationResult === RESULTS.GRANTED) {
            console.log('Legacy Android location permission granted');
            setPermissionError(null);
            return { success: true, permissionType: null };
          } else {
            console.log('Legacy Android location permission denied');
            setPermissionError('Location permission is required for Bluetooth scanning on this Android version. Please enable it in Settings.');
            return { success: false, permissionType: 'location' };
          }
        }
      } else {
        const bluetoothState = await state.manager.state();
        if (bluetoothState === 'Unauthorized') {
          setPermissionError('Bluetooth access is denied. Please enable it in Settings.');
          return { success: false, permissionType: 'bluetooth' };
        }
        return { success: true, permissionType: null };
      }
    } catch (error) {
      console.log('Permission request error:', error);
      setPermissionError('Failed to request Bluetooth permissions.');
      return { success: false, permissionType: 'bluetooth' };
    }
  };

  const checkBluetoothPermissions = async (): Promise<{ hasPermission: boolean; permissionType: string | null }> => {
    try {
      if (Platform.OS === 'android') {
        const androidVersion = Platform.Version as number;

        if (androidVersion >= 31) {
          const scanStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_SCAN);
          const connectStatus = await check(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT);
          const hasPermission = scanStatus === RESULTS.GRANTED && connectStatus === RESULTS.GRANTED;
          return { hasPermission, permissionType: hasPermission ? null : 'bluetooth' };
        } else {
          const locationStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
          const hasPermission = locationStatus === RESULTS.GRANTED;
          return { hasPermission, permissionType: hasPermission ? null : 'location' };
        }
      }
      return { hasPermission: true, permissionType: null }; // iOS
    } catch (error) {
      console.log('Permission check error:', error);
      return { hasPermission: false, permissionType: 'bluetooth' };
    }
  };
  const handleConnect = useCallback(
    debounce(async () => {
      console.log('handleConnect called');
      if (!serial || state.connecting) return;

      // Clear any previous errors
      setPermissionError(null);
      setShowErrorPopup(false);
      setErrorMessage('');

      // Check if permissions are already granted
      const permissionCheck = await checkBluetoothPermissions();
      console.log('Permission check result:', permissionCheck);

      // Check Bluetooth state
      const bluetoothState = await state.manager.state();
      if (bluetoothState === 'Unauthorized') {
        setErrorMessage('Bluetooth access is denied. Please enable it in Settings.');
        setErrorPopupPermissionType('bluetooth');
        setShowErrorPopup(true);
        return;
      } else if (bluetoothState !== 'PoweredOn') {
        setErrorMessage('Bluetooth is not enabled. Please turn it on in Settings.');
        setErrorPopupPermissionType('bluetooth');
        setShowErrorPopup(true);
        return;
      }

      // Request permissions if not already granted
      let permissionResult = { success: permissionCheck.hasPermission, permissionType: permissionCheck.permissionType };
      if (!permissionCheck.hasPermission) {
        permissionResult = await requestBluetoothPermission();
        console.log('Permission request result:', permissionResult);
      }

      if (!permissionResult.success) {
        // Set appropriate error message and store permission type for settings navigation
        if (permissionResult.permissionType === 'location') {
          setErrorMessage('Location permission is required for Bluetooth scanning on this Android version. Please enable it in Settings.');
        } else {
          setErrorMessage('Bluetooth permissions are required. Please enable them in Settings.');
        }

        setErrorPopupPermissionType(permissionResult.permissionType);
        setShowErrorPopup(true);
        return;
      }

      try {
        console.log('Starting connection process...');
        await connect(serial.trim());
        console.log('Connect function completed');
      } catch (error) {
        console.log('Connection error:', error);
      }
    }, 1000, { leading: true, trailing: false }),
    [serial, state.connecting, state.manager, connect]
  );
  // const handleConnect = () => {
  //   console.log('Navigating to files screen');
  //   router.push('/files');
  // };

  const handleSupportToggle = (isVisible: boolean) => {
    setSupportVisible(isVisible);
  };

  const handleBackToLogin = () => {
    setSupportVisible(false);
  };

  const handleErrorPopupClose = () => {
    setShowErrorPopup(false);
    setErrorMessage('');
  };

  const handleErrorPopupButtonPress = () => {
    setShowErrorPopup(false);
    const currentErrorMessage = errorMessage;
    setErrorMessage('');

    // Navigate to appropriate settings based on permission type or error message
    if (errorPopupPermissionType === 'location' || currentErrorMessage.includes('Location')) {
      openLocationSettings();
    } else if (errorPopupPermissionType === 'bluetooth' || currentErrorMessage.includes('Bluetooth')) {
      openBluetoothSettings();
    }

    // Clear the permission type
    setErrorPopupPermissionType(null);
  };
  const openBluetoothSettings = () => {
    if (Platform.OS === 'android') {
      IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.BLUETOOTH_SETTINGS
      );
    } else {
      Linking.openSettings();
    }
  }

  const openLocationSettings = () => {
    if (Platform.OS === 'android') {
      IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS
      );
    } else {
      Linking.openSettings();
    }
  };

  if (showSplash) {
    return (
      <View style={styles.splashContainer}>
        <Image
          source={require('@/assets/images/ocean_monitor.png')}
          style={styles.splashImage}
          resizeMode="cover"
        />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <CommonHeader
        onSupportToggle={handleSupportToggle}
        isOnSupportScreen={isSupportVisible}
      />

      <ScrollView contentContainerStyle={styles.scrollViewContent}>
        <View style={styles.contentArea}>
          {isSupportVisible ? (
            <TechnicalSupport onBack={handleBackToLogin} />
          ) : (
            <View style={styles.loginWrapper}>
              {/* Loader Container */}
              {(state.connecting || state.searching || state.authenticating) && (
                <View style={styles.loaderWrapper}>
                  <View style={styles.loaderContainer}>
                    <Image
                      source={require('@/assets/images/Loading.gif')} // Path to your loader GIF
                      style={styles.loader}
                    />
                    <Text style={styles.loadingText}>
                      {state.statusMessage || 'Connecting...'}
                    </Text>
                  </View>
                </View>
              )}

              {/* Login Box */}
              <View style={styles.loginBox}>
                <Text style={styles.welcome}>Welcome to</Text>
                <Text style={styles.brand}>OceanMonitor</Text>
                <Text style={styles.label}>Enter ZebraTech Deck Unit Serial Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Serial Number"
                  placeholderTextColor="#B0B0B0"
                  value={serial}
                  onChangeText={(text) => setSerial(text.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                />
                {permissionError && (
                  <TouchableOpacity onPress={() => Linking.openSettings()}>
                    <Text style={styles.error}>{permissionError}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleConnect}
                  style={[
                    styles.ctaButton,
                    (!serial || state.connecting) && { opacity: 0.7 },
                  ]}
                  disabled={!serial || state.connecting}
                >
                  <Text style={styles.ctaText}>
                    {state.connecting ? 'Connecting...' : 'Connect'}
                  </Text>
                </TouchableOpacity>
                {state.error && !showErrorPopup && (
                  <Text style={styles.error}>
                    {/* {typeof state.error === 'string' ? state.error : 'Connection error'} */}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>

        <Image
          source={require('@/assets/images/image_2.png')}
          style={styles.bottomImage}
          resizeMode="cover"
        />
      </ScrollView>

      {/* Error Popup */}
      <ErrorPopup
        visible={showErrorPopup}
        title="ERROR!"
        message={errorMessage || 'Connection failed! Please check your Deck Unit serial number and try again!'}
        buttonText="Try Again"
        onClose={handleErrorPopupClose}
        onButtonPress={handleErrorPopupButtonPress}
      />
    </SafeAreaView>
  );
}

const BLUE = '#005A9C';
const DARK = '#333';
const LIGHT_BG = '#FFFFFF';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  splashImage: {
    width: '100%',
    height: '100%',
  },
  contentArea: {
    flex: 1,
    paddingVertical: 80,
    paddingHorizontal: 20,
  },
  loginWrapper: {
    position: 'relative', // To position the loader above the login box
  },
  loaderWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)', // Semi-transparent white overlay
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10, // High z-index to cover everything
  },
  loaderContainer: {
    backgroundColor: 'transparent', // Transparent background for loader container
    justifyContent: 'center',
    alignItems: 'center',
  },
  loader: {
    width: 140, // Size of the loader GIF
    height: 120,
  },
  loginBox: {
    backgroundColor: '#F4F7FA',
    borderRadius: 12,
    padding: 25,
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.20,
    shadowRadius: 1.41,
    elevation: 2,
  },
  welcome: {
    fontSize: 24,
    color: DARK,
  },
  brand: {
    fontSize: 36,
    fontWeight: 'bold',
    color: BLUE,
    marginBottom: 25,
  },
  label: {
    alignSelf: 'center',
    fontSize: 16,
    color: '#555',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    height: 50,
    borderColor: '#CCC',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    backgroundColor: '#FFF',
    marginBottom: 20,
  },
  ctaButton: {
    width: '100%',
    height: 50,
    backgroundColor: BLUE,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  bottomImage: {
    width: '100%',
    height: 100,
  },
  error: {
    color: 'red',
    marginTop: 10,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  scrollViewContent: {
    flexGrow: 1,
    paddingBottom: 0,
  }, loadingText: {
    fontSize: 16,
    color: '#666666',
    marginTop: 15,
    textAlign: 'center',
    fontWeight: '500',
  },
});