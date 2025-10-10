import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback, Dimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { pacificLogoSvg } from '@/app/svgContants';
import { Ionicons } from '@expo/vector-icons';

interface CommonHeaderProps {
    onSupportToggle?: (isVisible: boolean) => void;
    rightComponent?: React.ReactNode; // For custom right side components like disconnect button
    showBackButton?: boolean; // To determine whether to show the back button
    onBackPress?: () => void; // Function to handle back button press
    showLogout?: boolean; // New prop to show logout button
    onLogout?: () => void;
    isOnSupportScreen?: boolean;
}

const CommonHeader: React.FC<CommonHeaderProps> = ({
    onSupportToggle,
    rightComponent,
    showBackButton = false,
    onBackPress,
    showLogout = false,
    onLogout,
    isOnSupportScreen = false
}) => {
    const [isMenuVisible, setMenuVisible] = useState(false);

    // Close menu when isOnSupportScreen changes
    useEffect(() => {
        if (isOnSupportScreen) {
            setMenuVisible(false);
        }
    }, [isOnSupportScreen]);

    const handleMenuToggle = () => {
        setMenuVisible(!isMenuVisible);
    };

    const handleCloseMenu = () => {
        setMenuVisible(false);
    };

    const handleLogout = () => {
        handleCloseMenu();
        if (onLogout) {
            onLogout();
        }
    };

    const handleSupportClick = () => {
        handleCloseMenu();
        if (onSupportToggle) {
            onSupportToggle(true);
        }
    };

    return (
        <View style={styles.container}>
            {/* Top blue bar */}
            <View style={styles.topHeader} />

            {/* Main header with padding only for subHeader */}
            <View style={styles.subHeaderWrapper}>
                <View style={styles.subHeader}>
                    <View style={styles.headerLeft}>
                        {/* Back Button */}
                        {showBackButton && (
                            <TouchableOpacity onPress={onBackPress} style={styles.backButton}>
                                <Ionicons name="arrow-back" size={24} color="#003F72" />
                            </TouchableOpacity>
                        )}

                        <View style={styles.logoContainer}>
                            <SvgXml xml={pacificLogoSvg} style={styles.logo} width={163} height={66} />
                        </View>
                    </View>

                    <View style={styles.headerRight}>
                        {rightComponent}
                        <TouchableOpacity onPress={handleMenuToggle} style={styles.menuButton}>
                            <View style={styles.menuIcon}>
                                <View style={styles.menuLine} />
                                <View style={styles.menuLine} />
                                <View style={styles.menuLine} />
                            </View>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Dropdown Menu */}
            {isMenuVisible && (
                <>
                    {/* Overlay to close menu when clicking outside */}
                    <TouchableWithoutFeedback onPress={handleCloseMenu}>
                        <View style={styles.overlay} />
                    </TouchableWithoutFeedback>

                    <View style={styles.dropdownMenu}>
                        {/* Only show Technical Support if NOT on support screen */}
                        {!isOnSupportScreen && (
                            <TouchableOpacity
                                onPress={handleSupportClick}
                                style={styles.dropdownItem}>
                                <Text style={styles.dropdownIcon}>⚙️</Text>
                                <Text style={styles.dropdownText}>Technical Support</Text>
                            </TouchableOpacity>
                        )}

                        {/* Always show logout option if showLogout is true */}
                        {showLogout && (
                            <TouchableOpacity
                                onPress={handleLogout}
                                style={styles.dropdownItem}>
                                <Text style={styles.dropdownIcon}>🚪</Text>
                                <Text style={styles.dropdownText}>Logout</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </>
            )}
        </View>
    );
};

const { height: screenHeight } = Dimensions.get('window');

const styles = StyleSheet.create({
    container: {
        position: 'relative',
        zIndex: 1,
    },
    overlay: {
        position: 'absolute',
        top: -100,
        left: -50,
        right: -50,
        height: screenHeight,
        backgroundColor: 'transparent',
        zIndex: 15,
    },
    topHeader: {
        backgroundColor: '#003F72',
        height: 50,
    },
    subHeaderWrapper: {
        paddingHorizontal: 10,
        paddingVertical: 10
    },
    subHeader: {
        backgroundColor: '#FFFFFF',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        paddingVertical: 15, // Padding inside the subHeader
        borderRadius: 15,      // Round the corners for card-like effect
        shadowColor: '#000',   // Shadow for the card effect
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 5,
        elevation: 5,          // Elevation for Android to create the shadow
        zIndex: 10,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    logoContainer: {
        marginRight: 15,      // Space between logo and next element (like the back button)
    },
    logo: {
        width: 50,
        height: 150,
    },
    menuButton: {
        marginLeft: 10,
    },
    menuIcon: {
        padding: 8,
    },
    menuLine: {
        width: 28,
        height: 3,
        backgroundColor: '#003F72',
        borderRadius: 2,
        marginVertical: 2.5,
    },
    backButton: {
        marginRight: 15,      // Increased space between back button and logo
    },
    dropdownMenu: {
        position: 'absolute',
        top: 125, // Adjusted to appear below the header
        right: 40,
        backgroundColor: '#E9F5FF',
        borderRadius: 8,
        paddingVertical: 2,
        paddingHorizontal: 30,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
        zIndex: 25,
    },
    dropdownItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    dropdownIcon: {
        marginRight: 10,
        fontSize: 16,
    },
    dropdownText: {
        fontSize: 16,
        color: '#333',
    },
});

export default CommonHeader;