import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface TechnicalSupportProps {
    onBack: () => void;
}

const TechnicalSupport: React.FC<TechnicalSupportProps> = ({ onBack }) => {
    return (
        <View style={styles.supportBox}>
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color="#005A9C" />
            </TouchableOpacity>
            <Text style={styles.supportTitle}>Technical Support</Text>
            <View style={styles.underline}></View>
            <Text style={styles.supportText}>
                For assistance with OceanMonitor and FVON data access, please reach out to our support team!
            </Text>
            <Text style={styles.supportContact}>Contact info:</Text>
            <Text style={styles.supportEmail}>Support-FVON@spc.int</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    supportBox: {
        backgroundColor: '#F4F7FA',
        borderRadius: 12,
        padding: 25,
        alignItems: 'center',
        marginHorizontal: 10,
        marginVertical: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.20,
        shadowRadius: 1.41,
        elevation: 2,
    },
    backButton: {
        alignSelf: 'flex-start',
        marginBottom: 25,
    },
    supportTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#005A9C',
        marginBottom: 10,
    },
    supportText: {
        fontSize: 18,
        color: '#555',
        textAlign: 'center',
        marginBottom: 10,
    },
    supportContact: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#005A9C',
        marginBottom: 5,
    },
    supportEmail: {
        fontSize: 16,
        color: '#005A9C',
    },
    underline: {
        width: '100%',
        height: 2,
        backgroundColor: '#005A9C',
        marginBottom: 15,
    },
});

export default TechnicalSupport;