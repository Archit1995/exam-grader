class PopupController {
    constructor() {
        this.currentMode = 'tier1';
        this.init();
    }
    
    async init() {
        this.gradeBtn = document.getElementById('gradeBtn');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.tier1 = document.getElementById('tier1-mode');
        this.tier2 = document.getElementById('tier2-mode');
        this.tier3 = document.getElementById('tier3-mode');
        this.resultsDiv = document.getElementById('results');
        
        // Tier 1: Auto-grade button
        this.gradeBtn.addEventListener('click', () => this.attemptGrading());
        
        // Tier 2: Confirmation buttons
        document.getElementById('confirmYes').addEventListener('click', () => this.gradeFromTier2());
        document.getElementById('confirmNo').addEventListener('click', () => this.switchToTier3());
        
        // Tier 3: Manual selection
        document.getElementById('startSelection').addEventListener('click', () => this.startManualSelection());
        document.getElementById('cancelSelection').addEventListener('click', () => this.resetToTier1());
        
        await this.checkPageStatus();
    }
    
    async checkPageStatus() {
        try {
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            
            if (!tab.url.includes('app.crowdmark.com/exams')) {
                this.updateStatus('❌ Not on Crowdmark exam page', 'error');
                return;
            }
            
            if (!tab.url.includes('/grading/student/')) {
                this.updateStatus('❌ Navigate to an exam question first', 'error');
                return;
            }
            
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'pageReady'
            });
            
            if (response?.ready) {
                this.currentTab = tab;
                this.updateStatus('✓ Ready to grade', 'ready');
                this.gradeBtn.disabled = false;
            }
        } catch (error) {
            this.updateStatus('❌ Content script not loaded', 'error');
        }
    }
    
    // Tier 1: Attempt automatic grading
    async attemptGrading() {
        try {
            this.updateStatus('⏳ Analyzing solution...', 'processing');
            this.gradeBtn.disabled = true;
            
            const response = await chrome.tabs.sendMessage(this.currentTab.id, {
                action: 'startGrading'
            });
            
            if (response.success) {
                // Success! Show results
                this.updateStatus('✓ Grading complete!', 'ready');
                this.showResults(response.grade);
                this.resetUI();
            } else if (response.requiresConfirmation) {
                // Tier 2: Need TA confirmation
                this.switchToTier2(response.screenshot);
            } else if (response.requiresManualSelection) {
                // Tier 3: Need manual selection
                this.switchToTier3();
            }
        } catch (error) {
            this.updateStatus(`❌ Error: ${error.message}`, 'error');
            this.gradeBtn.disabled = false;
        }
    }
    
    // Tier 2: TA confirms the area
    switchToTier2(screenshotBase64) {
        this.updateStatus('⏳ Waiting for confirmation...', 'processing');
        this.currentMode = 'tier2';
        this.tier1.style.display = 'none';
        this.tier2.style.display = 'block';
        this.tier3.style.display = 'none';
        
        // Show preview
        document.getElementById('previewImage').src = `data:image/png;base64,${screenshotBase64}`;
    }
    
    async gradeFromTier2() {
        try {
            this.updateStatus('⏳ Grading...', 'processing');
            
            const response = await chrome.tabs.sendMessage(this.currentTab.id, {
                action: 'gradeFromPreview'
            });
            
            if (response.success) {
                this.updateStatus('✓ Grading complete!', 'ready');
                this.showResults(response.grade);
                this.resetUI();
            }
        } catch (error) {
            this.updateStatus(`❌ Error: ${error.message}`, 'error');
        }
    }
    
    // Tier 3: Manual selection
    switchToTier3() {
        this.updateStatus('📍 Select the solution area', 'processing');
        this.currentMode = 'tier3';
        this.tier1.style.display = 'none';
        this.tier2.style.display = 'none';
        this.tier3.style.display = 'block';
    }
    
    async startManualSelection() {
        try {
            this.updateStatus('⏳ Waiting for selection...', 'processing');
            
            // Tell content script to enter selection mode
            const response = await chrome.tabs.sendMessage(this.currentTab.id, {
                action: 'enterSelectionMode'
            });
            
            if (response.success) {
                // Wait for TA to make selection
                const selectionResponse = await this.waitForSelection();
                
                if (selectionResponse.cancelled) {
                    this.resetToTier1();
                    return;
                }
                
                // Grade the selected area
                const gradeResponse = await chrome.tabs.sendMessage(this.currentTab.id, {
                    action: 'gradeSelection',
                    coordinates: selectionResponse.coordinates
                });
                
                if (gradeResponse.success) {
                    this.updateStatus('✓ Grading complete!', 'ready');
                    this.showResults(gradeResponse.grade);
                    this.resetUI();
                }
            }
        } catch (error) {
            this.updateStatus(`❌ Error: ${error.message}`, 'error');
            this.resetToTier1();
        }
    }
    
    waitForSelection() {
        return new Promise((resolve, reject) => {
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                if (request.action === 'selectionComplete') {
                    resolve(request);
                }
            });
        });
    }
    
    resetToTier1() {
        this.currentMode = 'tier1';
        this.tier1.style.display = 'block';
        this.tier2.style.display = 'none';
        this.tier3.style.display = 'none';
        this.updateStatus('✓ Ready to grade', 'ready');
        this.gradeBtn.disabled = false;
    }
    
    resetUI() {
        setTimeout(() => this.resetToTier1(), 2000);
    }
    
    showResults(gradeData) {
        // ... same as before ...
    }
    
    updateStatus(message, type = 'info') {
        this.statusIndicator.textContent = message;
        this.statusIndicator.className = `status-indicator ${type}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});