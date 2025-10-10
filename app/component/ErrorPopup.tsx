import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface ErrorPopupProps {
    visible: boolean;
    title?: string;
    message: string;
    buttonText?: string;
    onClose: () => void;
    onButtonPress?: () => void;
}

const ErrorPopup: React.FC<ErrorPopupProps> = ({
    visible,
    title = "ERROR!",
    message,
    buttonText = "Try Again",
    onClose,
    onButtonPress
}) => {
    const handleButtonPress = () => {
        if (onButtonPress) {
            onButtonPress();
        } else {
            onClose();
        }
    };

    return (
        <Modal
            transparent={true}
            visible={visible}
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.popupContainer}>
                    {/* Error Icon */}
                    <View style={styles.iconContainer}>
                        <MaterialCommunityIcons
                            name="close-circle"
                            size={50}
                            color="#DC3545"
                        />
                    </View>

                    {/* Title */}
                    <Text style={styles.title}>{title}</Text>

                    {/* Message */}
                    <Text style={styles.message}>{message}</Text>

                    {/* Button */}
                    <TouchableOpacity
                        style={styles.button}
                        onPress={handleButtonPress}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.buttonText}>{buttonText}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 150,
    },
    popupContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 30,
        alignItems: 'center',
        maxWidth: 320,
        width: '100%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 10,
        // transform: [{ translateY: -50 }],

    },
    iconContainer: {
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#DC3545',
        marginBottom: 12,
        textAlign: 'center',
    },
    message: {
        fontSize: 16,
        color: '#333333',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 24,
    },
    button: {
        backgroundColor: '#DC3545',
        paddingVertical: 12,
        paddingHorizontal: 40,
        borderRadius: 8,
        minWidth: 120,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
});

export default ErrorPopup;