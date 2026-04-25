/**
 * background.js - Service Worker for Crowdmark Exam Grader Extension
 * 
 * Final Production-Ready Version
 * 
 * Responsibilities:
 * 1. Listen for messages from popup and content scripts
 * 2. Fetch question data (solution + rubric) from backend
 * 3. Handle API calls to Claude for grading
 * 4. Manage chrome.storage for question templates
 * 5. Health checks and logging
 */

// ===== Configuration =====
const CONFIG = {
    API_ENDPOINT: 'http://localhost:5000/api/grade',
    QUESTIONS_ENDPOINT: 'http://localhost:5000/api/question',
    DEBUG: true
};

// ===== Logging =====
function log(message, data = null) {
    if (CONFIG.DEBUG) {
        console.log(`[ExamGrader-BG] ${message}`, data || '');
    }
}

// ===== Main Message Router =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log('Message received:', { action: request.action });

    switch (request.action) {
        case 'gradeStudent':
            gradeStudent(request, sendResponse);
            return true;

        case 'saveQuestionTemplate':
            saveQuestionTemplate(request, sendResponse);
            return true;

        case 'getQuestionTemplate':
            getQuestionTemplate(request, sendResponse);
            return true;

        case 'deleteQuestionTemplate':
            deleteQuestionTemplate(request, sendResponse);
            return true;

        case 'getAllTemplates':
            getAllTemplates(sendResponse);
            return true;

        case 'clearAllStorage':
            clearAllStorage(sendResponse);
            return true;

        default:
            log('Unknown action:', request.action);
            sendResponse({ error: 'Unknown action' });
    }
});

// ===== Fetch Question Data =====
/**
 * Get question data (solution + rubric) from backend
 */
async function getQuestionData(questionId) {
    try {
        const url = `${CONFIG.QUESTIONS_ENDPOINT}/${questionId}`;
        log('Fetching question data from:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch question: ${response.status}`);
        }
        
        const data = await response.json();
        
        log('Question data received:', {
            questionId,
            hasSolution: !!data.solution,
            hasRubric: !!data.rubric,
            maxPoints: data.max_points
        });
        
        return data;
        
    } catch (error) {
        log('Error fetching question data:', error.message);
        throw error;
    }
}

// ===== Grade Student =====
/**
 * Main grading function
 * 1. Get question data from backend
 * 2. Call Claude API with screenshot + solution + rubric
 * 3. Return grade to popup
 */
async function gradeStudent(request, sendResponse) {
    try {
        log('Starting grade request for:', {
            questionId: request.questionId,
            bookletId: request.bookletId
        });

        // Validate screenshot
        if (!request.screenshot) {
            throw new Error('No screenshot provided');
        }

        if (!request.questionId) {
            throw new Error('No questionId provided');
        }

        // Get question data (solution + rubric)
        const questionData = await getQuestionData(request.questionId);
        
        if (!questionData.solution || !questionData.rubric) {
            throw new Error(`Question ${request.questionId} missing solution or rubric`);
        }

        log('Calling Claude API for grading...');
        
        // Call Claude API
        const response = await fetch(CONFIG.API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                screenshot: request.screenshot,
                rubric: questionData.rubric,
                solution: questionData.solution,
                questionId: request.questionId,
                bookletId: request.bookletId,
                timestamp: new Date().toISOString()
            })
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }

        const gradeData = await response.json();

        log('Grade received successfully:', {
            score: gradeData.score,
            confidence: gradeData.confidence
        });

        sendResponse({
            success: true,
            grade: gradeData,
            questionData: questionData
        });

    } catch (error) {
        log('Grading error:', error.message);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

// ===== Question Template Storage =====

/**
 * Save question template (selector + coordinates)
 * Used for remembering answer box location across students
 */
function saveQuestionTemplate(request, sendResponse) {
    try {
        const { questionId, selector, coordinates } = request;

        if (!questionId) {
            sendResponse({ success: false, error: 'questionId is required' });
            return;
        }

        const template = {
            questionId: questionId,
            selector: selector || null,
            coordinates: coordinates || null,
            timestamp: Date.now()
        };

        const storageKey = `q_${questionId}`;
        
        chrome.storage.local.set({ [storageKey]: template }, () => {
            if (chrome.runtime.lastError) {
                log('Error saving template:', chrome.runtime.lastError.message);
                sendResponse({
                    success: false,
                    error: chrome.runtime.lastError.message
                });
            } else {
                log('Template saved:', questionId);
                sendResponse({
                    success: true,
                    message: `Template saved for ${questionId}`
                });
            }
        });

    } catch (error) {
        log('Error saving template:', error.message);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

/**
 * Retrieve a question template
 */
function getQuestionTemplate(request, sendResponse) {
    try {
        const { questionId } = request;

        if (!questionId) {
            sendResponse({ success: false, error: 'questionId is required' });
            return;
        }

        const storageKey = `q_${questionId}`;

        chrome.storage.local.get([storageKey], (result) => {
            if (chrome.runtime.lastError) {
                sendResponse({
                    success: false,
                    error: chrome.runtime.lastError.message
                });
            } else {
                const template = result[storageKey] || null;
                log('Template retrieved:', { questionId, found: !!template });
                sendResponse({
                    success: true,
                    template: template
                });
            }
        });

    } catch (error) {
        log('Error retrieving template:', error.message);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

/**
 * Delete a question template
 */
function deleteQuestionTemplate(request, sendResponse) {
    try {
        const { questionId } = request;

        if (!questionId) {
            sendResponse({ success: false, error: 'questionId is required' });
            return;
        }

        const storageKey = `q_${questionId}`;

        chrome.storage.local.remove([storageKey], () => {
            if (chrome.runtime.lastError) {
                sendResponse({
                    success: false,
                    error: chrome.runtime.lastError.message
                });
            } else {
                log('Template deleted:', questionId);
                sendResponse({
                    success: true,
                    message: `Template deleted for ${questionId}`
                });
            }
        });

    } catch (error) {
        log('Error deleting template:', error.message);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

/**
 * Get all saved question templates
 */
function getAllTemplates(sendResponse) {
    try {
        chrome.storage.local.get(null, (result) => {
            if (chrome.runtime.lastError) {
                sendResponse({
                    success: false,
                    error: chrome.runtime.lastError.message
                });
            } else {
                const templates = {};
                Object.keys(result).forEach(key => {
                    if (key.startsWith('q_')) {
                        templates[key] = result[key];
                    }
                });

                const count = Object.keys(templates).length;
                log(`Retrieved ${count} templates`);

                sendResponse({
                    success: true,
                    templates: templates,
                    count: count
                });
            }
        });

    } catch (error) {
        log('Error retrieving all templates:', error.message);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

/**
 * Clear all extension storage (for debugging)
 */
function clearAllStorage(sendResponse) {
    try {
        chrome.storage.local.clear(() => {
            if (chrome.runtime.lastError) {
                sendResponse({
                    success: false,
                    error: chrome.runtime.lastError.message
                });
            } else {
                log('All storage cleared');
                sendResponse({
                    success: true,
                    message: 'All storage cleared'
                });
            }
        });

    } catch (error) {
        log('Error clearing storage:', error.message);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

// ===== Extension Lifecycle =====

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        log('Extension installed');
    } else if (details.reason === 'update') {
        log('Extension updated');
    }
});

// ===== Health Check =====

setInterval(async () => {
    try {
        const healthUrl = CONFIG.QUESTIONS_ENDPOINT.replace('/api/question', '/api/health');
        const response = await fetch(healthUrl, { method: 'GET' });
        if (response.ok) {
            log('Backend health check: OK ✓');
        }
    } catch (error) {
        log('Backend health check failed:', error.message);
    }
}, 5 * 60 * 1000);

// ===== Initialize =====

log('Background service worker loaded ✓');