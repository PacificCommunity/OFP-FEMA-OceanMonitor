import React, { useEffect, useState, useMemo, useRef, JSX, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Dimensions, ActivityIndicator, Image, BackHandler, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Svg, Rect, Circle, Path, Text as SvgText } from 'react-native-svg';
import { pacificLogoSvg } from '@/app/svgContants';
import { SvgXml } from 'react-native-svg';
import * as ScreenOrientation from 'expo-screen-orientation';
import { getFileContent, parseCSVContent } from '@/src/service/DataService';
import CommonHeader from './component/CommonHeader';
import TechnicalSupport from './component/TechnicalSupport';
import { useBLE } from '@/src/context/BLEContext';
import { useFocusEffect } from '@react-navigation/native';
import { Animated } from 'react-native';


interface DataPoint {
    x: number;
    y: number;
    value: number;
    temperature: number;
    depth: number;
    dateTime: string;
    color: string;
    originalIndex: number;
}

interface FileMetadata {
    [key: string]: string;
}

interface ProcessedCSVData {
    metadata: FileMetadata;
    data: any[];
}

const VisualizationScreen: React.FC = () => {
    const router = useRouter();
    const params = useLocalSearchParams();
    const [displayData, setDisplayData] = useState<DataPoint[]>([]);
    const [baseData, setBaseData] = useState<DataPoint[]>([]);
    const { state } = useBLE();
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [isLandscapeMode, setIsLandscapeMode] = useState<boolean>(false);
    const [screenDimensions, setScreenDimensions] = useState(Dimensions.get('window'));
    const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null);
    const [currentFileName, setCurrentFileName] = useState<string>('');
    const [isSupportVisible, setSupportVisible] = useState<boolean>(false);
    const screenActiveRef = useRef<boolean>(true);
    const connectionPreservationRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [temperatureRange, setTemperatureRange] = useState<{ min: number, max: number } | null>(null);
    const [selectedPoint, setSelectedPoint] = useState<DataPoint | null>(null);
    const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
    const [showScrollIndicator, setShowScrollIndicator] = useState(false);
    const scrollPosition = useRef(new Animated.Value(0)).current;
    const [trackHeight, setTrackHeight] = useState(0);

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

        Animated.timing(scrollPosition, {
            toValue: scrollPercentage,
            duration: 0,
            useNativeDriver: true,
        }).start();
    };

    // All the existing lifecycle methods remain the same...
    useFocusEffect(
        React.useCallback(() => {
            console.log('VisualizationScreen focused');
            screenActiveRef.current = true;

            if (state?.connected) {
                console.log('Starting connection preservation for visualization');
                startConnectionPreservation();
            }

            return () => {
                console.log('VisualizationScreen blurred');
                screenActiveRef.current = false;
                stopConnectionPreservation();
            };
        }, [state?.connected])
    );

    const startConnectionPreservation = (): void => {
        if (connectionPreservationRef.current) {
            clearInterval(connectionPreservationRef.current);
        }

        connectionPreservationRef.current = setInterval(() => {
            if (screenActiveRef.current && state?.device && state?.connected) {
                preserveConnectionHealth();
            }
        }, 20000);
    };

    const stopConnectionPreservation = (): void => {
        if (connectionPreservationRef.current) {
            clearInterval(connectionPreservationRef.current);
            connectionPreservationRef.current = null;
        }
    };

    const preserveConnectionHealth = async (): Promise<void> => {
        if (!state?.device) return;

        try {
            const isConnected = await state.device.isConnected();
            if (isConnected) {
                console.log('Connection health check - OK');
            } else {
                console.log('Connection health check - Device disconnected');
            }
        } catch (error) {
            console.log('Connection preservation error:', error);
        }
    };

    const handleBackNavigation = (): void => {
        console.log('Back navigation requested from VisualizationScreen');
        stopConnectionPreservation();
        router.back();

        if (state?.connected) {
            console.log('Navigating back with active connection preserved');
        } else {
            console.log('Navigating back - no active connection');
        }
    };

    useEffect(() => {
        return () => {
            stopConnectionPreservation();
        };
    }, []);

    const memoizedParams = useMemo(() => ({
        fileName: params.fileName as string,
        content: params.content as string
    }), [params.fileName, params.content]);

    useEffect(() => {
        const subscription = Dimensions.addEventListener('change', ({ window }) => {
            setScreenDimensions(window);
        });

        return () => subscription?.remove();
    }, []);

    useEffect(() => {
        const backAction = () => {
            if (isLandscapeMode) {
                // If in landscape mode, exit landscape instead of navigating back
                exitLandscapeMode();
                return true; // Prevent default back action
            }
            return false; // Allow default back action (go to previous screen)
        };

        const backHandler = BackHandler.addEventListener(
            'hardwareBackPress',
            backAction,
        );

        return () => backHandler.remove();
    }, [isLandscapeMode]);

    const enterLandscapeMode = async (): Promise<void> => {
        try {
            await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
            setIsLandscapeMode(true);
        } catch (error) {
            console.log('Error entering landscape mode:', error);
            setIsLandscapeMode(true);
        }
    };

    const exitLandscapeMode = async (): Promise<void> => {
        try {
            await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
            setIsLandscapeMode(false);
        } catch (error) {
            console.log('Error exiting landscape mode:', error);
            setIsLandscapeMode(false);
        }
    };

    useEffect(() => {
        return () => {
            ScreenOrientation.unlockAsync();
        };
    }, []);

    const handleSupportToggle = (isVisible: boolean): void => {
        setSupportVisible(isVisible);
    };

    const handleBackToVisualization = (): void => {
        setSupportVisible(false);
    };

    const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 42, g: 58, b: 148 };
    };

    const getTemperatureColor = (temp: number, minTemp: number, maxTemp: number): string => {
        if (isNaN(temp) || temp === null || temp === undefined) {
            return '#2A3A94';
        }

        if (maxTemp === minTemp) {
            return '#B0407F';
        }

        const normalized = (temp - minTemp) / (maxTemp - minTemp);
        const clampedNormalized = Math.max(0, Math.min(1, normalized));

        const colors = [
            '#2A3A94', '#533A92', '#76368F', '#B0407F', '#D04F6A', '#F3924A', '#FBE189'
        ];

        const segmentSize = 1 / (colors.length - 1);
        const segmentIndex = Math.floor(clampedNormalized / segmentSize);
        const segmentProgress = (clampedNormalized % segmentSize) / segmentSize;

        if (segmentIndex >= colors.length - 1) {
            return colors[colors.length - 1];
        }

        const color1 = hexToRgb(colors[segmentIndex]);
        const color2 = hexToRgb(colors[segmentIndex + 1]);

        const r = Math.round(color1.r + (color2.r - color1.r) * segmentProgress);
        const g = Math.round(color1.g + (color2.g - color1.g) * segmentProgress);
        const b = Math.round(color1.b + (color2.b - color1.b) * segmentProgress);

        return `rgb(${r}, ${g}, ${b})`;
    };

    const calculateTemperatureRange = (data: DataPoint[]): { min: number, max: number } => {
        if (data.length === 0) {
            return { min: 19, max: 26 };
        }

        const temperatures = data.map(d => d.temperature).filter(t => !isNaN(t) && t !== null && t !== undefined);

        if (temperatures.length === 0) {
            return { min: 19, max: 26 };
        }

        const min = Math.min(...temperatures);
        const max = Math.max(...temperatures);
        const padding = (max - min) * 0.05 || 0.5;

        return {
            min: min - padding,
            max: max + padding
        };
    };

    const extractSensorNumber = (fileName: string): string => {
        const match = fileName.match(/MOANA_(\d+)_/);
        return match ? match[1] : 'Unknown';
    };

    const formatDateTimeSafe = (dateTimeStr?: string): string => {
        if (!dateTimeStr || dateTimeStr.length < 15) {
            return 'N/A';
        }

        try {
            const year = dateTimeStr.slice(0, 4);
            const month = dateTimeStr.slice(4, 6);
            const day = dateTimeStr.slice(6, 8);
            const hour = dateTimeStr.slice(9, 11);
            const minute = dateTimeStr.slice(11, 13);

            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            const monthName = monthNames[parseInt(month) - 1] || 'Unknown';

            return `${day} ${monthName}, ${year}     ${hour}:${minute}`;
        } catch (error) {
            console.log('Error formatting date:', error);
            return 'N/A';
        }
    };

    const formatCoordinate = (coord: string): string => {
        if (!coord || coord === '-') return 'N/A';
        const num = parseFloat(coord);
        return isNaN(num) ? 'N/A' : `${Math.abs(num).toFixed(6)}°${num >= 0 ? 'N' : 'S'}`;
    };

    const formatLongitude = (coord: string): string => {
        if (!coord || coord === '-') return 'N/A';
        const num = parseFloat(coord);
        return isNaN(num) ? 'N/A' : `${Math.abs(num).toFixed(6)}°${num >= 0 ? 'E' : 'W'}`;
    };

    const calculateStats = (data: DataPoint[]): {
        minTemp: number;
        maxTemp: number;
        avgTemp: number;
        minDepth: number;
        maxDepth: number;
        avgDepth: number;
        firstMeasurement: DataPoint;
        lastMeasurement: DataPoint;
    } | null => {
        if (!data || data.length === 0) return null;

        const temperatures = data.map(d => d.temperature).filter(t => !isNaN(t) && t !== null && t !== undefined);
        const depths = data.map(d => d.depth).filter(d => !isNaN(d) && d !== null && d !== undefined);

        if (temperatures.length === 0 || depths.length === 0) return null;

        return {
            minTemp: Math.min(...temperatures),
            maxTemp: Math.max(...temperatures),
            avgTemp: temperatures.reduce((a, b) => a + b, 0) / temperatures.length,
            minDepth: Math.min(...depths),
            maxDepth: Math.max(...depths),
            avgDepth: depths.reduce((a, b) => a + b, 0) / depths.length,
            firstMeasurement: data[0],
            lastMeasurement: data[data.length - 1]
        };
    };

    // SIMPLIFIED DATA PROCESSING - REMOVED ALL ZOOM FUNCTIONALITY
    const processDataForDisplay = (csvData: ProcessedCSVData): void => {
        console.log('=== Processing Data for Simple Display (Max 30 Points) ===');

        // First pass: create all data points with original indices
        const allProcessedData: DataPoint[] = csvData.data.map((row: any, index: number) => {
            let temperature = parseFloat(row.temperature || row['Temperature C'] || row.temp);
            if (isNaN(temperature)) {
                temperature = 20;
            }

            let depth = parseFloat(row.depth || row['Depth Decibar'] || row.dep);
            if (isNaN(depth)) {
                depth = index * 10;
            }

            let timestamp: number;
            const dateTimeStr = row.dateTime || row['DateTime (UTC)'] || '';

            try {
                if (dateTimeStr.length >= 13) {
                    const year = dateTimeStr.slice(0, 4);
                    const month = dateTimeStr.slice(4, 6);
                    const day = dateTimeStr.slice(6, 8);
                    const hour = dateTimeStr.slice(9, 11);
                    const minute = dateTimeStr.slice(11, 13);
                    const second = dateTimeStr.slice(13, 15) || '00';
                    timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).getTime();
                } else {
                    timestamp = Date.now() + (index * 60000);
                }
            } catch (e) {
                timestamp = Date.now() + (index * 60000);
            }

            return {
                x: timestamp,
                y: depth,
                value: temperature,
                temperature: temperature,
                depth: depth,
                dateTime: dateTimeStr,
                color: '#2A3A94',
                originalIndex: index
            };
        }).filter((item: DataPoint) => {
            return !isNaN(item.x) && !isNaN(item.y) && !isNaN(item.value);
        });

        console.log(`Total measurements: ${allProcessedData.length}`);

        // Calculate temperature range from all data
        const tempRange = calculateTemperatureRange(allProcessedData);
        setTemperatureRange(tempRange);

        // Apply colors based on calculated range
        const coloredData = allProcessedData.map(point => ({
            ...point,
            color: getTemperatureColor(point.temperature, tempRange.min, tempRange.max)
        }));

        // Store all data for stats calculation
        setBaseData(coloredData);

        // SIMPLIFIED SAMPLING LOGIC: Show up to 30 points
        let sampledData: DataPoint[] = [];

        if (coloredData.length <= 30) {
            // If 30 or fewer measurements, show all points (1 point per measurement)
            sampledData = coloredData;
            console.log(`Showing all ${coloredData.length} measurements (≤30)`);
        } else {
            // If more than 30 measurements, sample evenly
            const step = Math.floor(coloredData.length / 30);
            console.log(`Sampling: showing 1 measurement every ${step} points (${coloredData.length}/30=${step.toFixed(1)})`);

            for (let i = 0; i < coloredData.length; i += step) {
                sampledData.push(coloredData[i]);
                if (sampledData.length >= 30) break;
            }

            // Always include the last measurement if it's not already included
            const lastPoint = coloredData[coloredData.length - 1];
            if (sampledData[sampledData.length - 1].originalIndex !== lastPoint.originalIndex) {
                if (sampledData.length >= 30) {
                    sampledData[29] = lastPoint; // Replace the 30th point with the last measurement
                } else {
                    sampledData.push(lastPoint);
                }
            }
        }

        console.log(`Final display points: ${sampledData.length}`);
        setDisplayData(sampledData);
    };

    // REMOVED: All zoom-related functions (zoomOut, zoomInToPoint, resetZoom, renderZoomControls)

    const renderDetailsCard = (): JSX.Element | null => {
        if (!fileMetadata) return null;

        // Calculate stats from ALL base data, not just display data
        const stats = calculateStats(baseData);
        const sensorNumber = extractSensorNumber(currentFileName);

        const downloadLat = fileMetadata['Download position']?.split(',')[0] || '';
        const downloadLon = fileMetadata['Download position']?.split(',')[1] || '';

        return (
            <View style={styles.detailsCard}>
                <Text style={styles.detailsTitle}>Moana Sensor #{fileMetadata['Moana Serial Number'] || sensorNumber}</Text>

                {/* Show total measurements info */}
                <Text style={styles.measurementInfo}>
                    Total Measurements: {baseData.length} | Displaying: {displayData.length} points
                </Text>

                <View style={styles.detailsGrid}>
                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>First Pos. (Lat & Long)</Text>
                        <Text style={styles.detailValue}>
                            {formatCoordinate(downloadLat)}, {formatLongitude(downloadLon)}
                        </Text>
                        <TouchableOpacity style={styles.expandIcon}>
                            <Ionicons name="chevron-up" size={16} color="#666" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>First Meas. (Date & Time)</Text>
                        <Text style={styles.detailValue}>
                            {stats?.firstMeasurement ? formatDateTimeSafe(stats.firstMeasurement.dateTime) : 'N/A'}
                        </Text>
                    </View>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Last Meas. (Date & Time)</Text>
                        <Text style={styles.detailValue}>
                            {stats?.lastMeasurement ? formatDateTimeSafe(stats.lastMeasurement.dateTime) : 'N/A'}
                        </Text>
                    </View>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Min temperature</Text>
                        <Text style={styles.detailValue}>
                            {stats ? `${stats.minTemp.toFixed(2)}°C` : 'N/A'}
                        </Text>
                    </View>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Max temperature</Text>
                        <Text style={styles.detailValue}>
                            {stats ? `${stats.maxTemp.toFixed(1)}°C` : 'N/A'}
                        </Text>
                    </View>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Average temperature</Text>
                        <Text style={styles.detailValue}>
                            {stats ? `${stats.avgTemp.toFixed(2)}°C` : 'N/A'}
                        </Text>
                    </View>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Min depth</Text>
                        <Text style={styles.detailValue}>
                            {stats ? `${stats.minDepth.toFixed(1)} m` : 'N/A'}
                        </Text>
                    </View>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Max depth</Text>
                        <Text style={styles.detailValue}>
                            {stats ? `${stats.maxDepth.toFixed(1)} m` : 'N/A'}
                        </Text>
                    </View>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Average depth</Text>
                        <Text style={styles.detailValue}>
                            {stats ? `${stats.avgDepth.toFixed(1)} m` : 'N/A'}
                        </Text>
                    </View>
                </View>
            </View>
        );
    };

    useEffect(() => {
        const fetchData = async (): Promise<void> => {
            console.log('=== Starting data fetch process ===');
            console.log('Params:', memoizedParams);

            try {
                let csvData: ProcessedCSVData | null = null;
                let fileName = '';

                if (memoizedParams.fileName && memoizedParams.content) {
                    console.log('Using data from navigation params');
                    fileName = memoizedParams.fileName;
                    csvData = parseCSVContent(memoizedParams.content);
                } else {
                    console.log('Using static fallback data');
                    const staticCSV = `Deck unit serial number,9994
Deck unit firmware version,5.27ble
Deck unit battery voltage,4.14
Deck unit battery percent,94.0
Upload position,-,-
Upload signal strength,-
Upload attempts,-
Upload time,-
Upload stats,-
Depth rating (m),200
Download position,-41.259435,+173.283116
Download Time,12/08/2025 02:06:32
Download Attempts,1
Moana Serial Number,1350
Moana Firmware,MOANA-3.05
Protocol Version,2
Moana calibration date,29/05/2025
Reset Codes, 0x1
Moana Battery (V),3.59
Max Lifetime Depth (dBar),100.0
Baseline(mBar),1067
DateTime (UTC),Lat,Lon,Depth Decibar,Temperature C
20250812T020535,-41.259533,+173.283215,7.4,21.611
20250812T020621,-41.259458,+173.283105,0.3,20.655
20250812T020622,-41.259458,+173.283105,0.6,19.905
20250812T020623,-41.259458,+173.283105,1.2,20.322
20250812T020624,-41.259458,+173.283105,2.1,21.455
20250812T020625,-41.259458,+173.283105,3.4,22.100
20250812T020626,-41.259458,+173.283105,4.7,20.889
20250812T020627,-41.259458,+173.283105,5.9,21.234
20250812T020628,-41.259458,+173.283105,7.2,19.766
20250812T020629,-41.259458,+173.283105,8.5,20.443
20250812T020630,-41.259458,+173.283105,9.1,21.892
20250812T020631,-41.259458,+173.283105,10.3,20.155
20250812T020632,-41.259458,+173.283105,11.6,22.334
20250812T020633,-41.259458,+173.283105,12.8,21.077
20250812T020634,-41.259458,+173.283105,13.2,20.698
20250812T020635,-41.259458,+173.283105,14.5,21.523
20250812T020636,-41.259458,+173.283105,15.7,22.111
20250812T020637,-41.259458,+173.283105,16.9,20.887
20250812T020638,-41.259458,+173.283105,18.1,21.445
20250812T020639,-41.259458,+173.283105,19.3,20.234
20250812T020640,-41.259458,+173.283105,20.5,22.567
20250812T020641,-41.259458,+173.283105,21.7,21.889
20250812T020642,-41.259458,+173.283105,22.9,20.445
20250812T020643,-41.259458,+173.283105,24.1,21.223
20250812T020644,-41.259458,+173.283105,25.3,22.678
END`;
                    fileName = 'MOANA_1350_1_250812020535.csv';
                    csvData = parseCSVContent(staticCSV);
                }

                console.log('=== Parsed CSV Data ===');
                console.log('Metadata:', csvData.metadata);
                console.log('Data rows:', csvData.data.length);

                setCurrentFileName(fileName);
                setFileMetadata(csvData.metadata);

                // Use the simplified processing function
                processDataForDisplay(csvData);

            } catch (err) {
                console.log('Error fetching data:', err);
                setError('Failed to load profiles');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [memoizedParams]);

    const formatDateTime = (timestamp: number): string => {
        const date = new Date(timestamp);
        const day = date.getUTCDate().toString().padStart(2, '0');
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        return `${day}/${month} ${hours}:${minutes}`;
    };

    const renderTemperatureGradient = (gradientWidth: number): JSX.Element[] => {
        if (!temperatureRange) {
            return [];
        }

        const segments = 100;
        const segmentWidth = gradientWidth / segments;
        const colors = [
            '#2A3A94', '#533A92', '#76368F', '#B0407F', '#D04F6A', '#F3924A', '#FBE189'
        ];

        const gradientSegments: JSX.Element[] = [];
        for (let i = 0; i < segments; i++) {
            const progress = i / (segments - 1);
            const segmentSize = 1 / (colors.length - 1);
            const segmentIndex = Math.floor(progress / segmentSize);
            const segmentProgress = (progress % segmentSize) / segmentSize;

            let color: string;
            if (segmentIndex >= colors.length - 1) {
                color = colors[colors.length - 1];
            } else {
                const color1 = hexToRgb(colors[segmentIndex]);
                const color2 = hexToRgb(colors[segmentIndex + 1]);

                const r = Math.round(color1.r + (color2.r - color1.r) * segmentProgress);
                const g = Math.round(color1.g + (color2.g - color1.g) * segmentProgress);
                const b = Math.round(color1.b + (color2.b - color1.b) * segmentProgress);

                color = `rgb(${r}, ${g}, ${b})`;
            }

            gradientSegments.push(
                <Rect
                    key={`temp-gradient-${i}`}
                    x={i * segmentWidth}
                    y={5}
                    width={segmentWidth + 1}
                    height={20}
                    fill={color}
                />
            );
        }

        return gradientSegments;
    };

    const renderTemperatureScaleLabels = (): string[] => {
        if (!temperatureRange) {
            return ['19', '20', '21', '22', '23', '24', '25', '26'];
        }

        const { min, max } = temperatureRange;
        const range = max - min;
        const numLabels = 8;

        const labels: string[] = [];
        for (let i = 0; i < numLabels; i++) {
            const temp = min + (range * i) / (numLabels - 1);
            labels.push(temp.toFixed(1));
        }

        return labels;
    };

    const formatDateTimeForTooltip = (timestamp: number): string => {
        const date = new Date(timestamp);
        const day = date.getUTCDate();
        const month = date.getUTCMonth() + 1;
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        return `${day}/${month} ${hours}:${minutes} UTC`;
    };

    const renderVerticalTemperatureGradient = (gradientHeight: number): JSX.Element[] => {
        if (!temperatureRange) {
            return [];
        }

        const segments = 100;
        const segmentHeight = gradientHeight / segments;
        const colors = [
            '#FBE189', '#F3924A', '#D04F6A', '#B0407F', '#76368F', '#533A92', '#2A3A94'
        ];

        const gradientSegments: JSX.Element[] = [];
        for (let i = 0; i < segments; i++) {
            const progress = i / (segments - 1);
            const segmentSize = 1 / (colors.length - 1);
            const segmentIndex = Math.floor(progress / segmentSize);
            const segmentProgress = (progress % segmentSize) / segmentSize;

            let color: string;
            if (segmentIndex >= colors.length - 1) {
                color = colors[colors.length - 1];
            } else {
                const color1 = hexToRgb(colors[segmentIndex]);
                const color2 = hexToRgb(colors[segmentIndex + 1]);

                const r = Math.round(color1.r + (color2.r - color1.r) * segmentProgress);
                const g = Math.round(color1.g + (color2.g - color1.g) * segmentProgress);
                const b = Math.round(color1.b + (color2.b - color1.b) * segmentProgress);

                color = `rgb(${r}, ${g}, ${b})`;
            }

            gradientSegments.push(
                <Rect
                    key={`vert-gradient-${i}`}
                    x={5}
                    y={i * segmentHeight}
                    width={20}
                    height={segmentHeight + 1}
                    fill={color}
                />
            );
        }
        return gradientSegments;
    };

    const renderVerticalTemperatureScaleLabels = (): string[] => {
        if (!temperatureRange) {
            return ['26', '25', '24', '23', '22', '21', '20', '19'];
        }

        const { min, max } = temperatureRange;
        const range = max - min;
        const numLabels = 8;

        const labels: string[] = [];
        for (let i = 0; i < numLabels; i++) {
            const temp = max - (range * i) / (numLabels - 1); // Reversed for vertical
            labels.push(temp.toFixed(1));
        }

        return labels;
    };

    const renderCustomChart = (): JSX.Element => {
        console.log('=== Rendering Chart ===');

        if (loading) {
            return (
                <View style={styles.chartLoadingContainer}>
                    <ActivityIndicator size="large" color="#135B95" />
                    <Text style={styles.loadingText}>Loading chart data...</Text>
                </View>
            );
        }

        const isCurrentlyLandscape = screenDimensions.width > screenDimensions.height;

        let chartWidth: number, chartHeight: number;

        if (isLandscapeMode && isCurrentlyLandscape) {
            chartWidth = screenDimensions.width - 320;
            chartHeight = screenDimensions.height - 140;
        } else if (isLandscapeMode) {
            chartWidth = screenDimensions.height - 200;
            chartHeight = screenDimensions.width - 160;
        } else {
            chartWidth = screenDimensions.width - 120;
            chartHeight = 250;
        }

        const padding = 40;
        const bottomPadding = isLandscapeMode ? 160 : 160;
        const leftPadding = isLandscapeMode ? 80 : 60;

        // Set default ranges if no data
        let minDepth = 0;
        let maxDepth = 550;

        if (displayData.length > 0) {
            minDepth = Math.min(...displayData.map(d => d.y));
            maxDepth = Math.max(...displayData.map(d => d.y));

            const depthRange = maxDepth - minDepth;
            if (depthRange === 0) {
                const padding = Math.max(10, maxDepth * 0.1);
                minDepth = maxDepth - padding;
                maxDepth = maxDepth + padding;
            }
        }

        const generateDepthLabels = (): number[] => {
            console.log('Generating depth labels...');

            if (displayData.length === 0) {
                console.log('No data, using default labels');
                return [0, 10, 20, 30, 40, 50];
            }

            const actualMinDepth = Math.min(...displayData.map(d => d.y));
            const actualMaxDepth = Math.max(...displayData.map(d => d.y));
            const range = actualMaxDepth - actualMinDepth;

            console.log(`Actual depth range: ${actualMinDepth}m to ${actualMaxDepth}m (range: ${range}m)`);

            let step: number;
            let numLabels: number = 5;

            if (range <= 1) {
                step = 0.2;
                numLabels = 6;
            } else if (range <= 5) {
                step = 1;
                numLabels = 6;
            } else if (range <= 20) {
                step = 5;
                numLabels = 5;
            } else if (range <= 100) {
                step = 10;
                numLabels = 6;
            } else {
                step = Math.ceil(range / 5 / 10) * 10;
                numLabels = 6;
            }

            const labels: number[] = [];

            // Create evenly spaced labels within the range
            for (let i = 0; i < numLabels; i++) {
                const depth = actualMinDepth + (range * i) / (numLabels - 1);
                // Round to appropriate precision based on step size
                let roundedDepth: number;
                if (step < 1) {
                    roundedDepth = Math.round(depth * 10) / 10;
                } else {
                    roundedDepth = Math.round(depth);
                }
                labels.push(roundedDepth);
            }

            // Ensure min and max are included
            if (!labels.includes(actualMinDepth)) {
                labels[0] = Number(actualMinDepth.toFixed(1));
            }
            if (!labels.includes(actualMaxDepth)) {
                labels[labels.length - 1] = Number(actualMaxDepth.toFixed(1));
            }

            // Remove duplicates and sort
            const uniqueLabels = [...new Set(labels)].sort((a, b) => a - b);

            console.log('Generated depth labels:', uniqueLabels);
            return uniqueLabels;
        };

        const depthLabels = generateDepthLabels();

        const renderGradientLines = (): JSX.Element[] | null => {
            if (displayData.length === 0) {
                console.log('No data points to render lines');
                return null;
            }

            // Use index-based positioning for equal spacing
            const points = displayData.map((point, index) => ({
                x: leftPadding + (index / (displayData.length - 1)) * chartWidth,
                y: padding + ((point.y - minDepth) / (maxDepth - minDepth)) * chartHeight,
                color: point.color,
                temp: point.value
            }));

            const paths: JSX.Element[] = [];
            for (let i = 1; i < points.length; i++) {
                const prevPoint = points[i - 1];
                const currentPoint = points[i];
                let segmentPath = `M ${prevPoint.x} ${prevPoint.y}`;

                if (i === 1) {
                    const controlX = (prevPoint.x + currentPoint.x) / 2;
                    const controlY = (prevPoint.y + currentPoint.y) / 2;
                    segmentPath += ` Q ${controlX} ${controlY} ${currentPoint.x} ${currentPoint.y}`;
                } else {
                    const prevPrevPoint = points[i - 2];
                    const nextPoint = points[i + 1] || currentPoint;
                    const cp1x = prevPoint.x + (currentPoint.x - prevPrevPoint.x) * 0.15;
                    const cp1y = prevPoint.y + (currentPoint.y - prevPrevPoint.y) * 0.15;
                    const cp2x = currentPoint.x - (nextPoint.x - prevPoint.x) * 0.15;
                    const cp2y = currentPoint.y - (nextPoint.y - prevPoint.y) * 0.15;
                    segmentPath += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${currentPoint.x} ${currentPoint.y}`;
                }

                const blendColors = (color1: string, color2: string, ratio: number): string => {
                    const parseRGB = (colorStr: string): number[] => {
                        const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                        if (match) {
                            return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
                        }
                        return [42, 58, 148];
                    };

                    const rgb1 = parseRGB(color1);
                    const rgb2 = parseRGB(color2);

                    const r = Math.round(rgb1[0] + (rgb2[0] - rgb1[0]) * ratio);
                    const g = Math.round(rgb1[1] + (rgb2[1] - rgb1[1]) * ratio);
                    const b = Math.round(rgb1[2] + (rgb2[2] - rgb1[2]) * ratio);

                    return `rgb(${r}, ${g}, ${b})`;
                };

                const blendedColor = blendColors(prevPoint.color, currentPoint.color, 0.5);
                const strokeWidth = isLandscapeMode ? 6 : 4;

                paths.push(
                    <Path
                        key={`line-segment-${i}`}
                        d={segmentPath}
                        stroke={blendedColor}
                        strokeWidth={strokeWidth}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                );
            }
            return paths;
        };

        const dotRadius = isLandscapeMode ? 5 : 2;
        const fontSize = isLandscapeMode ? 11 : 10;
        const labelFontSize = isLandscapeMode ? 13 : 14;

        return (
            <ScrollView
                horizontal={isLandscapeMode}
                showsHorizontalScrollIndicator={isLandscapeMode}
                contentContainerStyle={isLandscapeMode ? {} : {}}
            >
                <TouchableOpacity
                    activeOpacity={1}
                    onPress={() => {
                        setSelectedPoint(null);
                        setTooltipPosition(null);
                    }}
                >
                    <View style={isLandscapeMode ? styles.landscapeChartContainer : styles.customChartContainer}>
                        <Svg width={chartWidth + leftPadding + padding} height={chartHeight + padding + bottomPadding}>
                            {/* Background */}
                            <Rect x={0} y={0} width={chartWidth + leftPadding + padding} height={chartHeight + padding + bottomPadding} fill="white" />

                            {/* Grid lines for depth */}
                            {depthLabels.map((depth, index) => {
                                if (depth >= minDepth && depth <= maxDepth) {
                                    const y = padding + ((depth - minDepth) / (maxDepth - minDepth)) * chartHeight;
                                    return (
                                        <Path
                                            key={`grid-horizontal-${depth}-${index}`}
                                            d={`M ${leftPadding} ${y} L ${leftPadding + chartWidth} ${y}`}
                                            stroke="#E5E5E5"
                                            strokeWidth="1"
                                            strokeDasharray="5,5"
                                        />
                                    );
                                }
                                return null;
                            })}

                            {/* Vertical grid lines with equal spacing */}
                            {displayData.length > 0 && displayData.map((point, index) => {
                                const showLine = isLandscapeMode ? (index % 2 === 0) : (index % 1 === 0);
                                if (showLine) {
                                    const x = leftPadding + (index / (displayData.length - 1)) * chartWidth;
                                    return (
                                        <Path
                                            key={`grid-vertical-${index}`}
                                            d={`M ${x} ${padding} L ${x} ${padding + chartHeight}`}
                                            stroke={isLandscapeMode ? "#DAD8D8FF" : "#DAD8D8FF"}
                                            strokeWidth="1"
                                            strokeDasharray={isLandscapeMode ? "5,5" : "2,2"}
                                        />
                                    );
                                }
                                return null;
                            })}

                            {/* Y-axis */}
                            <Path
                                d={`M ${leftPadding} ${padding} L ${leftPadding} ${padding + chartHeight}`}
                                stroke="#333"
                                strokeWidth="1.5"
                            />

                            {/* X-axis */}
                            <Path
                                d={`M ${leftPadding} ${padding + chartHeight} L ${leftPadding + chartWidth} ${padding + chartHeight}`}
                                stroke="#333"
                                strokeWidth="1.5"
                            />

                            {/* Y-axis label */}
                            <SvgText
                                x={isLandscapeMode ? 25 : 15}
                                y={padding + chartHeight / 2}
                                fontSize={labelFontSize}
                                fontWeight="bold"
                                textAnchor="middle"
                                fill="#333"
                                transform={`rotate(-90 ${isLandscapeMode ? 25 : 15} ${padding + chartHeight / 2})`}
                            >
                                Depth
                            </SvgText>

                            {/* Gradient lines */}
                            {renderGradientLines()}

                            {/* Data points with click handlers for tooltip */}
                            {displayData.map((point, index) => {
                                const x = leftPadding + (index / (displayData.length - 1)) * chartWidth;
                                const y = padding + ((point.y - minDepth) / (maxDepth - minDepth)) * chartHeight;

                                // Create a larger invisible circle for better touch detection
                                const hitRadius = isLandscapeMode ? 15 : 12;

                                return (
                                    <React.Fragment key={`point-${index}`}>
                                        {/* Larger invisible circle for touch area */}
                                        <Circle
                                            cx={x}
                                            cy={y}
                                            r={hitRadius}
                                            fill="transparent"
                                            onPress={(e) => {
                                                console.log('Point clicked:', point.temperature, point.depth);
                                                setSelectedPoint(point);
                                                setTooltipPosition({ x, y });
                                            }}
                                        />
                                        {/* Visible point */}
                                        <Circle
                                            cx={x}
                                            cy={y}
                                            r={dotRadius}
                                            fill={point.color}
                                            stroke="white"
                                            strokeWidth={isLandscapeMode ? 2 : 1}
                                            pointerEvents="none"
                                        />
                                    </React.Fragment>
                                );
                            })}

                            {/* Indicator ring around selected point - MOVED BEFORE TOOLTIP */}
                            {selectedPoint && tooltipPosition && (
                                <Circle
                                    cx={tooltipPosition.x}
                                    cy={tooltipPosition.y}
                                    r={dotRadius + 2}
                                    fill="none"
                                    stroke="#135B95"
                                    strokeWidth={2}
                                />
                            )}

                            {/* Tooltip */}
                            {selectedPoint && tooltipPosition && (() => {
                                // Tooltip dimensions
                                const tooltipWidth = 180;
                                const tooltipHeight = 105;
                                const tooltipPadding = 10;

                                // Calculate boundaries
                                const chartLeft = leftPadding;
                                const chartRight = leftPadding + chartWidth;
                                const chartTop = padding;
                                const chartBottom = padding + chartHeight;

                                // Default position (centered above the point)
                                let tooltipX = tooltipPosition.x;
                                let tooltipY = tooltipPosition.y - tooltipHeight / 2;

                                // Adjust horizontal position if too close to edges
                                if (tooltipX - tooltipWidth / 2 < chartLeft + tooltipPadding) {
                                    tooltipX = chartLeft + tooltipWidth / 2 + tooltipPadding;
                                } else if (tooltipX + tooltipWidth / 2 > chartRight - tooltipPadding) {
                                    tooltipX = chartRight - tooltipWidth / 2 - tooltipPadding;
                                }

                                // Adjust vertical position if too close to top or bottom
                                if (tooltipY < chartTop + tooltipPadding) {
                                    tooltipY = chartTop + tooltipPadding;
                                } else if (tooltipY + tooltipHeight > chartBottom - tooltipPadding) {
                                    tooltipY = chartBottom - tooltipHeight - tooltipPadding;
                                }

                                // Calculate the background rect position (top-left corner)
                                const rectX = tooltipX - tooltipWidth / 2;
                                const rectY = tooltipY;
                                const textStartX = rectX + 12; // Left padding for text

                                // Format date for tooltip (DD-MM-YYYY format)
                                const formatTooltipDate = (timestamp: number): string => {
                                    const date = new Date(timestamp);
                                    const day = date.getUTCDate().toString().padStart(2, '0');
                                    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
                                    const year = date.getUTCFullYear();
                                    return `${day}-${month}-${year}`;
                                };

                                // Format time for tooltip (HH:MM format)
                                const formatTooltipTime = (timestamp: number): string => {
                                    const date = new Date(timestamp);
                                    const hours = date.getUTCHours().toString().padStart(2, '0');
                                    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
                                    return `${hours}:${minutes}`;
                                };

                                return (
                                    <>
                                        {/* Tooltip background - light blue */}
                                        <Rect
                                            x={rectX}
                                            y={rectY}
                                            width={tooltipWidth}
                                            height={tooltipHeight}
                                            fill="#D6E9F8"
                                            stroke="#D6E9F8"
                                            strokeWidth={1}
                                            rx={8}
                                            opacity={0.95}
                                        />

                                        {/* Depth row */}
                                        <SvgText
                                            x={textStartX}
                                            y={rectY + 22}
                                            fontSize={16}
                                            fontWeight="500"
                                            textAnchor="start"
                                            fill="#000"
                                        >
                                            Depth:{' '}
                                        </SvgText>
                                        <SvgText
                                            x={textStartX + 55}
                                            y={rectY + 22}
                                            fontSize={16}
                                            fontWeight="400"
                                            textAnchor="start"
                                            fill="#000"
                                        >
                                            {selectedPoint.depth.toFixed(0)}m
                                        </SvgText>

                                        {/* Temperature row */}
                                        <SvgText
                                            x={textStartX}
                                            y={rectY + 44}
                                            fontSize={16}
                                            fontWeight="500"
                                            textAnchor="start"
                                            fill="#000"
                                        >
                                            Temperature:{' '}
                                        </SvgText>
                                        <SvgText
                                            x={textStartX + 105}
                                            y={rectY + 44}
                                            fontSize={16}
                                            fontWeight="400"
                                            textAnchor="start"
                                            fill="#000"
                                        >
                                            {selectedPoint.temperature.toFixed(0)} C
                                        </SvgText>

                                        {/* Date row */}
                                        <SvgText
                                            x={textStartX}
                                            y={rectY + 66}
                                            fontSize={16}
                                            fontWeight="500"
                                            textAnchor="start"
                                            fill="#000"
                                        >
                                            Date:{' '}
                                        </SvgText>
                                        <SvgText
                                            x={textStartX + 45}
                                            y={rectY + 66}
                                            fontSize={16}
                                            fontWeight="400"
                                            textAnchor="start"
                                            fill="#000"
                                        >
                                            {formatTooltipDate(selectedPoint.x)}
                                        </SvgText>

                                        {/* Time row */}
                                        <SvgText
                                            x={textStartX}
                                            y={rectY + 88}
                                            fontSize={16}
                                            fontWeight="500"
                                            textAnchor="start"
                                            fill="#000"
                                        >
                                            Time:{' '}
                                        </SvgText>
                                        <SvgText
                                            x={textStartX + 45}
                                            y={rectY + 88}
                                            fontSize={16}
                                            fontWeight="400"
                                            textAnchor="start"
                                            fill="#000"
                                        >
                                            {formatTooltipTime(selectedPoint.x)}
                                        </SvgText>

                                        {/* Indicator ring around selected point */}
                                        {/* <Circle
                                            cx={tooltipPosition.x}
                                            cy={tooltipPosition.y}
                                            r={dotRadius + 2}
                                            fill="none"
                                            stroke="#135B95"
                                            strokeWidth={2}
                                        /> */}
                                    </>
                                );
                            })()}

                            {/* Y-axis labels */}
                            {depthLabels.map((depth, index) => {
                                const labelY = padding + ((depth - minDepth) / (maxDepth - minDepth)) * chartHeight;
                                if (labelY >= padding && labelY <= (padding + chartHeight)) {
                                    return (
                                        <SvgText
                                            key={`depth-label-${depth}-${index}`}
                                            x={leftPadding - 12}
                                            y={labelY + 4}
                                            fontSize={fontSize}
                                            textAnchor="end"
                                            fill="#333"
                                            fontWeight="600"
                                        >
                                            {`${Math.round(depth)}m`}
                                        </SvgText>
                                    );
                                }
                                return null;
                            })}

                            {/* X-axis labels with equal spacing */}
                            {displayData.length > 0 && (() => {
                                const maxLabels = isLandscapeMode ? 8 : 4;
                                const labelInterval = Math.max(1, Math.floor(displayData.length / maxLabels));
                                const minLabelDistance = isLandscapeMode ? 80 : 60; // Minimum pixels between labels

                                // Generate initial label positions
                                const potentialLabels = [];

                                // Add regularly spaced labels
                                for (let i = 0; i < displayData.length; i += labelInterval) {
                                    const point = displayData[i];
                                    const baseX = leftPadding + (i / (displayData.length - 1)) * chartWidth;
                                    potentialLabels.push({
                                        index: i,
                                        x: baseX,
                                        point: point,
                                        isLast: false
                                    });
                                }

                                // Handle the last label specially to prevent overlap
                                const lastIndex = displayData.length - 1;
                                const lastPoint = displayData[lastIndex];
                                const lastX = leftPadding + chartWidth;

                                // Check if last label would be too close to the previous one
                                const lastRegularLabel = potentialLabels[potentialLabels.length - 1];
                                const distanceToLast = Math.abs(lastX - lastRegularLabel.x);

                                if (distanceToLast < minLabelDistance && potentialLabels.length > 1) {
                                    // Replace the second-to-last label with the last one to prevent overlap
                                    potentialLabels[potentialLabels.length - 1] = {
                                        index: lastIndex,
                                        x: lastX,
                                        point: lastPoint,
                                        isLast: true
                                    };
                                } else if (lastRegularLabel.index !== lastIndex) {
                                    // Add the last label if it's not already included and has enough space
                                    potentialLabels.push({
                                        index: lastIndex,
                                        x: lastX,
                                        point: lastPoint,
                                        isLast: true
                                    });
                                }


                                // Render the final set of labels
                                return potentialLabels.map(({ index, x, point, isLast }, labelIndex) => {
                                    const adjustedX = x - 20;
                                    const labelY = chartHeight + padding + (isLandscapeMode ? 60 : 50);
                                    const formattedTime = formatDateTime(point.x);

                                    return (
                                        <SvgText
                                            key={`time-label-${index}-${labelIndex}`}
                                            x={adjustedX}
                                            y={labelY}
                                            fontSize={fontSize}
                                            textAnchor="middle"
                                            fill="#666"
                                            fontWeight="500"
                                            transform={`rotate(-40 ${adjustedX} ${labelY})`}
                                        >
                                            {formattedTime}
                                        </SvgText>
                                    );
                                });
                            })()}

                            {/* X-axis label */}
                            <SvgText
                                x={leftPadding + chartWidth / 2.3}
                                y={chartHeight + padding + bottomPadding - 30}
                                fontSize={labelFontSize}
                                fontWeight="bold"
                                textAnchor="middle"
                                fill="#333"
                            >
                                Date (D/M H:M UTC)
                            </SvgText>
                        </Svg>
                    </View>
                </TouchableOpacity>
            </ScrollView>
        );
    };

    const renderVerticalTemperatureScale = (): JSX.Element => {
        const scaleHeight = Math.min(screenDimensions.height - 150, 300);

        return (
            <View style={styles.verticalTemperatureScale}>
                <View style={styles.verticalScaleContainer}>
                    <Svg height={scaleHeight} width="40">
                        {renderVerticalTemperatureGradient(scaleHeight)}
                    </Svg>
                    <View style={[styles.verticalScaleLabels, { height: scaleHeight }]}>
                        {temperatureRange && renderVerticalTemperatureScaleLabels().map((label, index) => (
                            <Text key={index} style={styles.verticalScaleLabelText}>{label}</Text>
                        ))}
                    </View>
                </View>
                <Text style={styles.verticalTemperatureTitle}>Temperature (°C)</Text>
            </View>
        );
    };

    // Landscape mode render
    const renderLandscapeMode = (): JSX.Element => {
        return (
            <View style={styles.landscapeContainer}>
                <StatusBar style="light" hidden />

                <View style={styles.landscapeHeader}>
                    <View style={styles.landscapeHeaderLeft}>
                        <SvgXml xml={pacificLogoSvg} width={80} height={30} />
                    </View>
                    <View style={styles.landscapeHeaderRight}>
                        <TouchableOpacity
                            style={styles.landscapeToggleButton}
                            onPress={exitLandscapeMode}
                        >
                            <Ionicons name="close" size={24} color="#333" />
                        </TouchableOpacity>
                    </View>
                </View>

                <ScrollView
                    horizontal={false}
                    contentContainerStyle={styles.landscapeScrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.landscapeChartWrapper}>
                        {loading ? (
                            <ActivityIndicator size="large" color="#0B5FAF" style={styles.loaderContainer} />
                        ) : error ? (
                            <Text style={styles.errorText}>{error}</Text>
                        ) : (
                            <View style={styles.landscapeMainContent}>
                                <View style={styles.chartSection}>
                                    {renderCustomChart()}
                                </View>
                                <View style={styles.temperatureSection}>
                                    {renderVerticalTemperatureScale()}
                                </View>
                            </View>
                        )}
                    </View>
                </ScrollView>
            </View>
        );
    };

    // If in landscape mode, render the landscape view
    if (isLandscapeMode) {
        return renderLandscapeMode();
    }

    // Normal portrait mode render
    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar style="light" />
            <View style={styles.screenContainer}>
                <CommonHeader
                    onSupportToggle={handleSupportToggle}
                    isOnSupportScreen={isSupportVisible}
                    showBackButton={true}
                    onBackPress={handleBackNavigation}
                />

                <ScrollView contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}>
                    {isSupportVisible ? (
                        <TechnicalSupport onBack={handleBackToVisualization} />
                    ) : (
                        <>
                            {renderDetailsCard()}

                            <View style={styles.chartContainer}>
                                <View style={styles.chartHeader}>
                                    <TouchableOpacity
                                        style={styles.toggleButton}
                                        onPress={enterLandscapeMode}
                                    >
                                        <Ionicons name="expand" size={16} color="#fff" />
                                    </TouchableOpacity>
                                </View>

                                {loading ? (
                                    <ActivityIndicator size="large" color="#0B5FAF" style={styles.loaderContainer} />
                                ) : error ? (
                                    <Text style={styles.errorText}>{error}</Text>
                                ) : (
                                    <>
                                        {renderCustomChart()}

                                        <View style={styles.temperatureScale}>
                                            <Text style={styles.temperatureTitle}>Temperature (°C)</Text>
                                            <View style={styles.scaleContainer}>
                                                <Svg height="30" width={screenDimensions.width - 100}>
                                                    {renderTemperatureGradient(screenDimensions.width - 100)}
                                                </Svg>
                                                <View style={styles.scaleLabels}>
                                                    {renderTemperatureScaleLabels().map((label, index) => (
                                                        <Text key={index} style={styles.scaleLabel}>{label}</Text>
                                                    ))}
                                                </View>
                                            </View>
                                        </View>
                                    </>
                                )}
                            </View>
                        </>
                    )}
                </ScrollView>
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

                <Image source={require('@/assets/images/image_2.png')} style={styles.bottomImage} resizeMode="cover" />
            </View>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({

    scrollIndicatorTrack: {
        position: 'absolute',
        right: 8,
        top: 190,
        bottom: 130,
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

    // Add this new style for the measurement info
    measurementInfo: {
        fontSize: 14,
        color: '#666',
        marginBottom: 15,
        fontWeight: '500',
        textAlign: 'center',
        backgroundColor: '#f8f9fa',
        padding: 8,
        borderRadius: 6,
    },

    // Add loading container style if it doesn't exist
    chartLoadingContainer: {
        height: 300,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 8,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
        color: '#135B95',
        fontWeight: '500',
    },
    // Main container styles
    safeArea: {
        flex: 1,
        backgroundColor: '#05376B'
    },
    screenContainer: {
        flex: 1,
        backgroundColor: '#F0F2F5'
    },
    topBar: {
        backgroundColor: '#135B95FF',
        height: 60,
        justifyContent: 'center',
        alignItems: 'center'
    },

    // Header styles
    backButton: {
        marginRight: 10
    },
    headerTextContainer: {
        flexDirection: 'column',
        alignItems: 'flex-start',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff'
    },
    headerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 20,
        paddingHorizontal: 16,
    },
    subtitle: {
        fontSize: 20,
        color: '#333',
        fontWeight: '500'
    },
    syncDate: {
        fontSize: 12,
        color: '#777',
        marginTop: 4
    },
    headerLeft: {
        flex: 1
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#003F72',
    },
    logo: {},
    headerlogoContainer: {
        backgroundColor: '#FFFFFF',
        marginHorizontal: 10,
        marginTop: 10,
        marginBottom: 10,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingHorizontal: 20,
        paddingVertical: 15,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
    },
    totalDataPoints: {
        fontSize: 12,
        color: '#000000',
        marginTop: 2,
        fontWeight: '500',
    },
    // Details Card styles
    detailsCard: {
        backgroundColor: '#FFFFFF',
        marginHorizontal: 1,
        marginBottom: 5,
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        marginTop: 10
    },
    detailsTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#0B5FAF',
        marginBottom: 15,
    },
    detailsGrid: {
        flexDirection: 'column',
    }, zoomButtonDisabled: {
        backgroundColor: '#f5f5f5',
        borderColor: '#ccc',
        opacity: 0.6,
    },
    zoomButtonTextDisabled: {
        color: '#999',
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    detailLabel: {
        flex: 1,
        fontSize: 14,
        color: '#0B5FAF',
        fontWeight: '500',
    },
    detailValue: {
        flex: 1,
        fontSize: 14,
        color: '#333',
        textAlign: 'right',
        marginRight: 10,
    },
    expandIcon: {
        padding: 4,
    },

    // Scroll and content styles
    scrollContent: {
        paddingHorizontal: 8,
        paddingBottom: 130
    },

    // Chart container styles
    chartContainer: {
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: 500,
        width: '100%',
        justifyContent: 'space-between',
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    chartHeader: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        width: '100%',
    },
    customChartContainer: {},
    toggleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#135B95',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    toggleButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },

    // Navigation styles
    navigationContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#f8f9fa',
        borderRadius: 8,
        marginTop: 15,
        borderWidth: 1,
        borderColor: '#e9ecef',
    },
    navigationInfo: {
        flex: 1,
    },
    navigationText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    navigationSubtext: {
        fontSize: 12,
        color: '#666',
        marginTop: 2,
    },
    navigationButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    navButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#fff',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#135B95',
        gap: 4,
    },
    navButtonDisabled: {
        backgroundColor: '#f5f5f5',
        borderColor: '#ccc',
    },
    navButtonText: {
        fontSize: 12,
        color: '#135B95',
        fontWeight: '500',
    },
    navButtonTextDisabled: {
        color: '#ccc',
    },

    // Loading and error styles
    loaderContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center'
    },
    errorText: {
        color: 'red',
        fontSize: 16,
        textAlign: 'center'
    },
    bottomImage: {
        position: 'absolute',
        bottom: 0,
        width: '100%',
        height: 120,
        zIndex: -1
    },

    // Temperature scale styles
    temperatureScale: {
        width: '100%',
        alignItems: 'center',
        marginTop: 20,
    },
    temperatureTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 10,
    },
    scaleContainer: {
        width: '90%',
        alignItems: 'center',
    },
    scaleLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        marginTop: 5,
    },
    scaleLabel: {
        fontSize: 10,
        color: '#666',
        fontWeight: '500',
    },

    // Landscape mode styles
    landscapeContainer: {
        flex: 1,
        backgroundColor: '#F0F2F5',
    },
    landscapeScrollContent: {
        flexGrow: 1,
        paddingHorizontal: 10,
        paddingVertical: 10,
    },
    landscapeHeader: {
        backgroundColor: 'transparent',
        height: 60,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 10,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
    },
    landscapeHeaderLeft: {
        flex: 0,
    },
    landscapeHeaderCenter: {
        flex: 1,
        alignItems: 'center',
    },
    landscapeHeaderRight: {
        flex: 0,
        alignItems: 'flex-end',
    },
    landscapeTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
        textAlign: 'center',
    },
    landscapeToggleButton: {
        backgroundColor: 'transparent',
        paddingVertical: 8,
        borderRadius: 20,
    },
    landscapeChartWrapper: {
        flex: 1,
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
        minHeight: 400,
    },
    landscapeMainContent: {
        flexDirection: 'row',
        flex: 1,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
    },
    chartSection: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 20,
    },
    temperatureSection: {
        width: 120,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 40,
    },
    landscapeChartContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
    },

    // Vertical temperature scale styles
    verticalTemperatureScale: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: 10,
    },
    verticalTemperatureTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#333',
        marginTop: 15,
        textAlign: 'center',
        width: 'auto',
    },
    verticalScaleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    verticalScaleLabels: {
        flexDirection: 'column',
        justifyContent: 'space-between',
        marginLeft: 12,
        paddingVertical: 5,
    },
    verticalScaleLabelText: {
        fontSize: 10,
        color: '#666',
        fontWeight: '500',
    },

    // Zoom controls styles (these were missing from the original)
    zoomControlsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#f0f8ff',
        borderRadius: 8,
        marginTop: 15,
        borderWidth: 1,
        borderColor: '#d0e8ff',
        width: '100%',
    },
    zoomInfo: {
        flex: 1,
    },
    zoomTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#135B95',
    },
    zoomLevel: {
        fontSize: 12,
        color: '#666',
        marginTop: 2,
    },
    zoomButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    zoomButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#fff',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#135B95',
        gap: 4,
        minWidth: 80,
    },
    resetButton: {
        backgroundColor: '#f8f9fa',
    },
    zoomButtonText: {
        fontSize: 12,
        color: '#135B95',
        fontWeight: '500',
    },
    zoomInfoText: {
        fontSize: 12,
        color: '#135B95',
        fontWeight: '600',
    },
    zoomOutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#fff',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#135B95',
        gap: 4,
    },
    zoomOutButtonText: {
        fontSize: 12,
        color: '#135B95',
        fontWeight: '500',
    },

    // Legacy zoom controls (from the incomplete section at the bottom)
    zoomControls: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#f0f8ff',
        borderRadius: 8,
        marginTop: 10,
        borderWidth: 1,
        borderColor: '#d0e8ff',
    },
});
export default VisualizationScreen;

