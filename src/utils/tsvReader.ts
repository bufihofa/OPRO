export interface QuestionAnswer {
  question: string;
  goldAnswer: number;
}

/**
 * Đọc file TSV và parse dữ liệu
 * @param filePath - Đường dẫn đến file TSV
 * @returns Promise chứa mảng các object {question, goldAnswer}
 */
export async function readTSVFile(filePath: string): Promise<QuestionAnswer[]> {
  try {
    // Fetch file từ đường dẫn
    const response = await fetch(filePath);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    
    // Đọc nội dung file
    const text = await response.text();
    
    // Split theo dòng
    const lines = text.split('\n').filter(line => line.trim() !== '');
    
    // Parse mỗi dòng
    const results: QuestionAnswer[] = lines.map((line, index) => {
      try {
        // Split theo tab character
        const columns = line.split('\t');
        
        if (columns.length < 2) {
          console.warn(`Line ${index + 1} doesn't have enough columns`);
          return null;
        }
        
        // Column 0: question
        // Column 1: goldAnswer
        const question = columns[0].trim();
        const goldAnswer = Number(columns[1].trim());
        
        return {
          question,
          goldAnswer,
        };
      } catch (error) {
        console.error(`Error parsing line ${index + 1}:`, error);
        return null;
      }
    }).filter((item): item is QuestionAnswer => item !== null);
    
    return results;
  } catch (error) {
    console.error('Error reading TSV file:', error);
    throw error;
  }
}