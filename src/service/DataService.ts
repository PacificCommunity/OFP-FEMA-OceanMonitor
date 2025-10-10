// src/service/DataService.ts
import * as FileSystem from 'expo-file-system';

const DATA_DIR = FileSystem.documentDirectory + 'moana-data/';

// Ensure directory exists
export const ensureDirectoryExists = async () => {
    const dirInfo = await FileSystem.getInfoAsync(DATA_DIR);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(DATA_DIR, { intermediates: true });
    }
};

// Check if a file exists locally
export const fileExists = async (fileName: string): Promise<boolean> => {
    try {
        const filePath = DATA_DIR + fileName;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        return fileInfo.exists;
    } catch (error) {
        console.error('Error checking file existence:', error);
        return false;
    }
};

// Store a file only if it doesn't already exist
export const storeFileIfNotExists = async (fileName: string, content: string): Promise<boolean> => {
    try {
        const exists = await fileExists(fileName);
        if (exists) {
            console.log(`File already exists, skipping: ${fileName}`);
            return false;
        }

        await storeFile(fileName, content);
        return true;
    } catch (error) {
        console.error('Error in storeFileIfNotExists:', error);
        throw error;
    }
};

export const storeFile = async (fileName: string, content: string) => {
    try {
        await ensureDirectoryExists();
        const filePath = DATA_DIR + fileName;
        await FileSystem.writeAsStringAsync(filePath, content);
        console.log(`File stored successfully: ${fileName}`);

        // Automatically cleanup to keep only latest 10 files
        await keepOnlyLatestFiles(10);
    } catch (error) {
        console.error('Error storing file:', error);
        throw error;
    }
};

// Get file content
export const getFileContent = async (fileName: string): Promise<string | null> => {
    try {
        const filePath = DATA_DIR + fileName;
        const fileInfo = await FileSystem.getInfoAsync(filePath);

        if (!fileInfo.exists) {
            console.log(`File not found: ${fileName}`);
            return null;
        }

        const content = await FileSystem.readAsStringAsync(filePath);
        return content;
    } catch (error) {
        console.error('Error reading file:', error);
        return null;
    }
};

// Get list of stored files with metadata - optimized for performance
export const getStoredFiles = async () => {
    try {
        await ensureDirectoryExists();
        const files = await FileSystem.readDirectoryAsync(DATA_DIR);

        const fileInfos = await Promise.all(
            files
                .filter(file => file.endsWith('.csv'))
                .map(async (fileName) => {
                    const filePath = DATA_DIR + fileName;
                    const fileInfo = await FileSystem.getInfoAsync(filePath);

                    // Parse timestamp from filename (MOANA_1234_1_250102030405.csv)
                    const timestamp = parseTimestampFromFileName(fileName);

                    return {
                        fileName,
                        size: (fileInfo.exists && 'size' in fileInfo) ? fileInfo.size : 0,
                        timestamp: timestamp || (fileInfo.exists && 'modificationTime' in fileInfo ? new Date(fileInfo.modificationTime) : new Date()),
                        modificationTime: (fileInfo.exists && 'modificationTime' in fileInfo) ? fileInfo.modificationTime : undefined,
                        isLocal: true // Flag to identify locally stored files
                    };
                })
        );

        return fileInfos.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
        console.error('Error getting stored files:', error);
        return [];
    }
};

export const keepOnlyLatestFiles = async (maxFiles: number = 10) => {
    try {
        const allFiles = await getStoredFiles();

        if (allFiles.length <= maxFiles) {
            console.log(`Only ${allFiles.length} files stored, no cleanup needed`);
            return 0;
        }

        // Files are already sorted by timestamp (newest first) from getStoredFiles()
        const filesToDelete = allFiles.slice(maxFiles); // Get files beyond the limit

        for (const file of filesToDelete) {
            await deleteFile(file.fileName);
            console.log(`Deleted old file to maintain limit: ${file.fileName}`);
        }

        console.log(`Cleanup complete: removed ${filesToDelete.length} old files, kept latest ${maxFiles}`);
        return filesToDelete.length;
    } catch (error) {
        console.error('Error during file limit cleanup:', error);
        return 0;
    }
};


// Get file names that exist locally (for quick existence check)
export const getLocalFileNames = async (): Promise<Set<string>> => {
    try {
        await ensureDirectoryExists();
        const files = await FileSystem.readDirectoryAsync(DATA_DIR);
        const csvFiles = files.filter(file => file.endsWith('.csv'));
        console.log(`Found ${csvFiles.length} local CSV files`);
        return new Set(csvFiles);
    } catch (error) {
        console.error('Error getting local file names:', error);
        return new Set();
    }
};

export const cleanupFilesOlderThan48Hours = async () => {
    return await cleanupOldFiles(2);
};

// Merge BLE files with local files, prioritizing BLE metadata
export const mergeFileLists = async (bleFiles: any[]): Promise<any[]> => {
    try {
        const localFiles = await getStoredFiles();
        const localFileNames = new Set(localFiles.map(f => f.fileName));

        const fileMap = new Map();

        // Add BLE files first (they have priority)
        bleFiles.forEach(file => {
            fileMap.set(file.fileName, {
                ...file,
                isLocal: localFileNames.has(file.fileName),
                source: 'ble'
            });
        });

        // Add local-only files (files that exist locally but not in BLE list)
        localFiles.forEach(file => {
            if (!fileMap.has(file.fileName)) {
                fileMap.set(file.fileName, {
                    ...file,
                    source: 'local'
                });
            }
        });

        return Array.from(fileMap.values())
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
        console.error('Error merging file lists:', error);
        return bleFiles; // Fallback to BLE files only
    }
};

// Delete a file
export const deleteFile = async (fileName: string) => {
    try {
        const filePath = DATA_DIR + fileName;
        const fileInfo = await FileSystem.getInfoAsync(filePath);

        if (fileInfo.exists) {
            await FileSystem.deleteAsync(filePath);
            console.log(`File deleted: ${fileName}`);
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        throw error;
    }
};

// Clean up old files (older than specified days)
export const cleanupOldFiles = async (maxAgeDays: number = 7) => {
    try {
        const files = await getStoredFiles();
        const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

        const filesToDelete = files.filter(file =>
            file.timestamp.getTime() < cutoffTime
        );

        for (const file of filesToDelete) {
            await deleteFile(file.fileName);
            console.log(`Cleaned up old file: ${file.fileName}`);
        }

        console.log(`Cleanup complete: removed ${filesToDelete.length} old files`);
        return filesToDelete.length;
    } catch (error) {
        console.error('Error during cleanup:', error);
        return 0;
    }
};

// Parse CSV content into structured data
export const parseCSVContent = (content: string) => {
    try {
        const lines = content.split('\n');
        let dataStartIndex = -1;
        const metadata: Record<string, any> = {};

        // Find where the actual data starts (after "DateTime (UTC),Lat,Lon,Depth Decibar,Temperature C")
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Parse metadata lines (key,value format)
            if (line.includes(',') && !line.startsWith('DateTime') && !line.match(/^\d{8}T/)) {
                const [key, ...valueParts] = line.split(',');
                metadata[key] = valueParts.join(',');
            }

            // Find data header
            if (line.startsWith('DateTime (UTC),Lat,Lon,Depth Decibar,Temperature C')) {
                dataStartIndex = i + 1;
                break;
            }
        }

        if (dataStartIndex === -1) {
            throw new Error('Could not find data section in CSV');
        }

        // Parse data rows
        const dataRows = [];
        for (let i = dataStartIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === 'END' || !line) break;

            const [dateTime, lat, lon, depth, temperature] = line.split(',');

            if (dateTime && dateTime.match(/^\d{8}T\d{6}$/)) {
                dataRows.push({
                    dateTime,
                    lat: parseFloat(lat),
                    lon: parseFloat(lon),
                    depth: parseFloat(depth),
                    temperature: parseFloat(temperature)
                });
            }
        }

        return {
            metadata,
            data: dataRows,
            rawContent: content
        };

    } catch (error) {
        console.error('Error parsing CSV content:', error);
        throw error;
    }
};

// Helper function to parse timestamp from filename
const parseTimestampFromFileName = (fileName: string): Date | null => {
    try {
        // Extract timestamp from filename like "MOANA_1234_1_250102030405.csv"
        const match = fileName.match(/_(\d{12})\.csv$/);
        if (!match) return null;

        const timestamp = match[1];
        const year = 2000 + parseInt(timestamp.slice(0, 2), 10);
        const month = parseInt(timestamp.slice(2, 4), 10) - 1; // Month is 0-indexed
        const day = parseInt(timestamp.slice(4, 6), 10);
        const hour = parseInt(timestamp.slice(6, 8), 10);
        const minute = parseInt(timestamp.slice(8, 10), 10);
        const second = parseInt(timestamp.slice(10, 12), 10);

        return new Date(Date.UTC(year, month, day, hour, minute, second));
    } catch (error) {
        console.error('Error parsing timestamp from filename:', fileName, error);
        return null;
    }
};

// Get file statistics
export const getFileStatistics = async (fileName: string) => {
    try {
        const content = await getFileContent(fileName);
        if (!content) return null;

        const parsed = parseCSVContent(content);

        return {
            fileName,
            recordCount: parsed.data.length,
            dateRange: {
                start: parsed.data.length > 0 ? parsed.data[0].dateTime : null,
                end: parsed.data.length > 0 ? parsed.data[parsed.data.length - 1].dateTime : null
            },
            depthRange: {
                min: Math.min(...parsed.data.map(d => d.depth)),
                max: Math.max(...parsed.data.map(d => d.depth))
            },
            temperatureRange: {
                min: Math.min(...parsed.data.map(d => d.temperature)),
                max: Math.max(...parsed.data.map(d => d.temperature))
            },
            metadata: parsed.metadata
        };
    } catch (error) {
        console.error('Error getting file statistics:', error);
        return null;
    }
};

// Get storage usage information
export const getStorageInfo = async () => {
    try {
        await ensureDirectoryExists();
        const files = await FileSystem.readDirectoryAsync(DATA_DIR);

        let totalSize = 0;
        let fileCount = 0;

        for (const fileName of files) {
            if (fileName.endsWith('.csv')) {
                const filePath = DATA_DIR + fileName;
                const fileInfo = await FileSystem.getInfoAsync(filePath);
                if (fileInfo.exists && 'size' in fileInfo) {
                    totalSize += fileInfo.size;
                    fileCount++;
                }
            }
        }

        return {
            fileCount,
            totalSize,
            directory: DATA_DIR
        };
    } catch (error) {
        console.error('Error getting storage info:', error);
        return {
            fileCount: 0,
            totalSize: 0,
            directory: DATA_DIR
        };
    }
};