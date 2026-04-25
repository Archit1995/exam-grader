from flask import Flask, request, jsonify
import anthropic
import os
import json
from dotenv import load_dotenv
import hvac

app = Flask(__name__)

# ===== Load .env from Custom Path =====
def load_env_from_custom_path():
    """Load .env file from custom path"""
    
    env_paths = [
        os.getenv('ENV_PATH'),
        os.path.expanduser('~/.config/exam-grader/.env'),
        os.path.expanduser('~/.exam-grader/.env'),
        '.env'
    ]
    
    for env_path in env_paths:
        if not env_path:
            continue
            
        expanded_path = os.path.expanduser(env_path)
        
        if os.path.exists(expanded_path):
            print(f"📂 Loading .env from: {expanded_path}")
            load_dotenv(expanded_path)
            return expanded_path
    
    print("⚠️  No .env file found, using environment variables")
    return None

# Load environment variables
env_path = load_env_from_custom_path()

# Initialize Claude client with Vault support
def get_claude_api_key():
    """Get Claude API key from multiple sources in order"""
    
    # Try direct environment variable first
    api_key = os.getenv('CLAUDE_API_KEY')
    if api_key:
        print("✅ Using CLAUDE_API_KEY from environment variable")
        return api_key
    
    # Try Vault
    try:
        vault_addr = os.getenv('VAULT_ADDR')
        vault_token = os.getenv('VAULT_TOKEN')
        vault_mount_point = os.getenv('VAULT_MOUNT_POINT', 'secret')
        vault_secret_path = os.getenv('VAULT_SECRET_PATH')
        vault_secret_key = os.getenv('VAULT_SECRET_KEY')  
        
        # DEBUG OUTPUT
        print("\n" + "="*80)
        print("🔍 DEBUG: Environment Variables from .env")
        print("="*80)
        print(f"   VAULT_ADDR:        {vault_addr}")
        print(f"   VAULT_TOKEN:       {'SET' if vault_token else 'NOT SET'}")
        print(f"   VAULT_MOUNT_POINT: {vault_mount_point}")
        print(f"   VAULT_SECRET_PATH: {vault_secret_path}")
        print(f"   VAULT_SECRET_KEY:  {vault_secret_key}")
        print("="*80 + "\n")
        
        if not vault_token:
            print("⚠️  VAULT_TOKEN not set, skipping Vault")
            return None
        
        if not vault_secret_path:
            print("⚠️  VAULT_SECRET_PATH not set, skipping Vault")
            return None
        
        print(f"🔐 Connecting to Vault at {vault_addr}...")
        client = hvac.Client(url=vault_addr, token=vault_token)
        
        # Read secret from Vault
        print(f"📍 Reading from path: {vault_secret_path}")
        # secret = client.secrets.kv.v2.read_secret_version(path=vault_secret_path, mount_point=vault_mount_point)
        secret = client.secrets.kv.v2.read_secret_version(path=vault_secret_path, mount_point=vault_mount_point)
        api_key = secret['data']['data'].get(vault_secret_key)
        
        if api_key:
            print(f"✅ Retrieved Claude API key from Vault ({vault_secret_path})")
            return api_key
        else:
            print(f"⚠️  Secret key '{vault_secret_key}' not found in Vault")
            return None
            
    except hvac.exceptions.Forbidden as e:
        print(f"⚠️  Vault authentication failed: {e}")
        return None
    except hvac.exceptions.InvalidPath as e:
        print(f"⚠️  Vault path not found: {e}")
        return None
    except Exception as e:
        print(f"⚠️  Vault error: {type(e).__name__}: {e}")
        return None

# Get API key and initialize client
api_key = get_claude_api_key()
client = None

if api_key:
    try:
        client = anthropic.Anthropic(api_key=api_key)
        print("✅ Claude API client initialized successfully")
    except Exception as e:
        print(f"❌ Failed to initialize Claude client: {e}")
else:
    print("❌ Could not retrieve Claude API key from any source")
    print("   Tried: CLAUDE_API_KEY env var, Vault")
    print("   Grade endpoint will return placeholder responses")

# Question data
QUESTIONS = {
    'q9': {
    'title': 'Logarithm Expansion',
    'solution': '3 log(x) + 0.5 log(y) - 2 log(z) [or equivalently: 3 log x + (1/2) log y - 2 log z]',
    'rubric': '''Q9 Logarithm Expansion (3 points):
Expand log(x³√y / z²) using logarithm properties:

FULL CREDIT (3 points):
- Correct answer: 3 log(x) + 0.5 log(y) - 2 log(z) [or 3 log x + (1/2) log y - 2 log z]
- Shows correct application of: log(ab) = log(a) + log(b), log(a/b) = log(a) - log(b), log(a^n) = n·log(a)

PARTIAL CREDIT:
- 2 points: Correct application of product/quotient rules but minor arithmetic/notation errors
- 1 point: Only correct application of power rule or other isolated parts

DEDUCT:
- Incorrect signs or coefficients
- Missing terms''',
    'max_points': 3
},
    'q10': {
        'title': 'System of Equations',
        'solution': 'x = 2, y = 3',
        'rubric': '''Q10 System of Equations (3 points):
Solve using substitution or elimination:
- 1 point: Set up equations correctly
- 1 point: Correct x value
- 1 point: Correct y value''',
        'max_points': 3
    },
    'q11': {
        'title': 'Integration by Parts',
        'solution': 'x*sin(x) + cos(x) + C',
        'rubric': '''Q11 Integration by Parts (3 points):
∫ x*cos(x) dx = x*sin(x) - ∫ sin(x) dx = x*sin(x) + cos(x) + C
- 1.5 points: Correct setup and u, dv selection
- 1.5 points: Correct integration and constant''',
        'max_points': 3
    }
}

# Token tracking
total_input_tokens = 0
total_output_tokens = 0
grade_count = 0


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'environment': 'development',
        'claude_api_available': client is not None,
        'env_file_path': env_path
    }), 200


@app.route('/api/question/<question_id>', methods=['GET'])
def get_question(question_id):
    """Get question data (solution + rubric)"""
    question_data = QUESTIONS.get(question_id)
    
    if not question_data:
        return jsonify({
            'error': f'Question {question_id} not found',
            'available_questions': list(QUESTIONS.keys())
        }), 404
    
    return jsonify(question_data), 200


@app.route('/api/questions', methods=['GET'])
def list_questions():
    """List all available questions"""
    questions_list = [
        {
            'id': q_id,
            'title': data['title'],
            'max_points': data['max_points']
        }
        for q_id, data in QUESTIONS.items()
    ]
    
    return jsonify({
        'questions': questions_list,
        'total': len(questions_list)
    }), 200


@app.route('/api/grade', methods=['POST'])
def grade_exam():
    """Grade a student's exam answer using Claude AI"""
    global total_input_tokens, total_output_tokens, grade_count
    
    try:
        data = request.get_json()
        
        # Validate required fields
        required = ['screenshot', 'rubric', 'solution']
        if not all(field in data for field in required):
            return jsonify({
                'error': f'Missing required fields. Expected: {required}'
            }), 400
        
        # If Claude not initialized, return placeholder
        if not client:
            return jsonify({
                'score': 2,
                'max_points': 3,
                'feedback': 'Claude API not configured. Please set up Vault or CLAUDE_API_KEY.',
                'confidence': 0,
                'deductions': []
            }), 200
        # Clean the base64 string just in case the frontend sends the "data:image/..." prefix
        b64_data = data['screenshot']
        if b64_data.startswith('data:'):
            b64_data = b64_data.split(',', 1)[1]

        # Dynamically determine the image type based on base64 magic bytes
        if b64_data.startswith('/9j/'):
            media_type = 'image/jpeg'
        elif b64_data.startswith('iVBORw0KGgo'):
            media_type = 'image/png'
        elif b64_data.startswith('UklGR'):
            media_type = 'image/webp'
        else:
            media_type = 'image/jpeg' # Fallback default
        print(f"📸 Received screenshot for grading (media type: {media_type})")
        # Call Claude to grade
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=1000,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64_data
                            }
                        },
                        {
                            "type": "text",
                            "text": f"""You are an expert math instructor grading exams. 

Grade the student's handwritten answer shown in the image.

CORRECT SOLUTION:
{data['solution']}

GRADING RUBRIC:
{data['rubric']}

Provide your response as JSON with this structure:
{{
    "score": <int: points earned>,
    "max_points": <int: total points>,
    "feedback": "<string: constructive feedback for student>",
    "confidence": <float: 0.0-1.0 confidence in grade>,
    "deductions": [
        {{"points": <int: negative>, "reason": "<string>"}},
    ]
}}

Return ONLY valid JSON, no markdown or explanation."""
                        }
                    ]
                }
            ]
        )
        
        # Extract and log token usage
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        total_tokens = input_tokens + output_tokens
        
        # Update running totals
        total_input_tokens += input_tokens
        total_output_tokens += output_tokens
        grade_count += 1
        
        # Print detailed token info
        print(f"\n{'='*70}")
        print(f"📊 GRADING INFERENCE #{grade_count} - Q{data.get('questionId')}")
        print(f"{'='*70}")
        print(f"  Input tokens:        {input_tokens:>8,}")
        print(f"  Output tokens:       {output_tokens:>8,}")
        print(f"  Inference tokens:    {total_tokens:>8,}")
        print(f"{'-'*70}")
        print(f"  Cumulative input:    {total_input_tokens:>8,}")
        print(f"  Cumulative output:   {total_output_tokens:>8,}")
        print(f"  Total cumulative:    {total_input_tokens + total_output_tokens:>8,}")
        print(f"{'='*70}\n")
        
        # Parse Claude's response
        # response_text = response.content[0].text
        # grade_data = json.loads(response_text)
        # Parse Claude's response
        response_text = response.content[0].text.strip()
        
        # Safely extract JSON even if Claude included markdown ticks or conversational text
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1
        
        if start_idx != -1 and end_idx != 0:
            cleaned_json_string = response_text[start_idx:end_idx]
        else:
            cleaned_json_string = response_text # Fallback just in case
            
        grade_data = json.loads(cleaned_json_string)
        
        # Add token info to grade data (optional, for debugging)
        grade_data['_tokens'] = {
            'input': input_tokens,
            'output': output_tokens,
            'total': total_tokens
        }
        
        print(f"✅ Graded Q{data.get('questionId')}: {grade_data['score']}/{grade_data['max_points']} | Confidence: {grade_data['confidence']:.0%}")
        
        return jsonify(grade_data), 200
        
    except json.JSONDecodeError as e:
        print(f"❌ JSON Parse Error: {e}")
        return jsonify({
            'error': 'Failed to parse Claude response as JSON',
            'details': str(e)
        }), 500
        
    except Exception as e:
        print(f"❌ Error in grade_exam: {type(e).__name__}: {str(e)}")
        return jsonify({
            'error': str(e)
        }), 500


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get token usage statistics"""
    return jsonify({
        'grades_processed': grade_count,
        'total_input_tokens': total_input_tokens,
        'total_output_tokens': total_output_tokens,
        'total_tokens': total_input_tokens + total_output_tokens,
        'avg_tokens_per_grade': (total_input_tokens + total_output_tokens) // grade_count if grade_count > 0 else 0
    }), 200


if __name__ == '__main__':
    print("🚀 Starting Crowdmark Exam Grader Backend")
    print("📝 Available endpoints:")
    print("   GET  /api/health - Health check")
    print("   GET  /api/questions - List all questions")
    print("   GET  /api/question/<id> - Get question details")
    print("   POST /api/grade - Grade an exam with Claude AI")
    print("   GET  /api/stats - Token usage statistics")
    
    if client:
        print("✅ Claude API connected")
    else:
        print("⚠️  Claude API not configured - using placeholder responses")
    
    print("\n" + "="*70)
    
    app.run(host='localhost', port=5000, debug=True)