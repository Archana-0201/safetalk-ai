import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import database

# Initialize FastAPI
app = FastAPI(title="SafeTalk AI Backend", description="Hybrid Edge-Cloud Moderation Server")

# Enable CORS for frontend file:// access and local development servers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permits access from local file system protocols
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ML Pipeline placeholder (lazy-loaded on demand to speed up server boot)
classifier = None

class UserStateRequest(BaseModel):
    username: str
    other_username: Optional[str] = None

class OffenseRequest(BaseModel):
    username: str
    text: str
    reason: str
    content_type: str

class ClearSuspensionRequest(BaseModel):
    username: str

class BlockRequest(BaseModel):
    blocker: str
    blocked: str

class WhitelistRequest(BaseModel):
    channel: str
    content_type: str
    content: str

class AnalyzeRequest(BaseModel):
    text: str

@app.on_event("startup")
def startup_event():
    # Setup database on startup
    database.init_db()
    print("[OK] SQLite Database Initialized.")

@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "message": "SafeTalk Server is connected & SQLite online."
    }

@app.post("/api/users/state")
def get_state(req: UserStateRequest):
    try:
        state = database.get_user_state(req.username, req.other_username)
        return state
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/users/offense")
def post_offense(req: OffenseRequest):
    try:
        # Default suspension duration set to 120,000ms (120s) for simulator presentation
        result = database.record_offense(
            username=req.username,
            text=req.text,
            reason=req.reason,
            content_type=req.content_type,
            suspension_duration_ms=120000
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/users/clear-suspension")
def clear_suspension(req: ClearSuspensionRequest):
    try:
        database.clear_user_suspension(req.username)
        return {"status": "success", "message": f"Suspension cleared for user {req.username}."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/users/block")
def block_user(req: BlockRequest):
    try:
        database.add_user_block(req.blocker, req.blocked)
        return {"status": "success", "message": f"User {req.blocker} blocked User {req.blocked}."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/users/unblock")
def unblock_user(req: BlockRequest):
    try:
        database.remove_user_block(req.blocker, req.blocked)
        return {"status": "success", "message": f"User {req.blocker} unblocked User {req.blocked}."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/whitelist/add")
def add_whitelist(req: WhitelistRequest):
    try:
        database.add_to_whitelist(req.channel, req.content_type, req.content)
        return {"status": "success", "message": "Item added to whitelist."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/whitelist/{channel}")
def get_whitelist(channel: str):
    try:
        whitelist = database.get_channel_whitelist(channel)
        return whitelist
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/moderation/analyze")
def analyze_cloud(req: AnalyzeRequest):
    global classifier
    text = req.text.strip()
    if not text:
        return {"isToxic": False, "reasons": []}
        
    print(f"[CLOUD TIER 2] Serving analysis request for text: '{text}'")
    
    # Lazy load Hugging Face model
    if classifier is None:
        try:
            from transformers import pipeline
            print("[CLOUD TIER 2] Loading Hugging Face Toxicity model (unitary/toxic-bert)...")
            # Load specific toxic-bert classification pipeline.
            # We use top_k=None to return probability scores for all classes.
            classifier = pipeline(
                "text-classification", 
                model="unitary/toxic-bert", 
                top_k=None
            )
            print("[OK] Hugging Face model loaded successfully.")
        except Exception as e:
            print(f"[Warning] Failed to load Hugging Face model: {e}")
            print("[CLOUD TIER 2] Falling back to high-fidelity regex/keyword matching engine.")
            classifier = "fallback"

    # Inference logic
    try:
        if classifier == "fallback":
            return run_fallback_moderation(text)
            
        # Run inference using Hugging Face model
        predictions = classifier(text)[0]
        reasons = []
        is_toxic = False
        
        # unitary/toxic-bert returns scores for: toxic, severe_toxic, obscene, threat, insult, identity_hate
        # Threshold set to 0.50 for secondary verification
        THRESHOLD = 0.50
        
        print(f"--- Model Predictions for '{text}' ---")
        for pred in predictions:
            label = pred['label']
            score = pred['score']
            print(f"  {label}: {score:.4f}")
            if score >= THRESHOLD:
                reasons.append(label)
                is_toxic = True
                
        return {
            "isToxic": is_toxic,
            "reasons": reasons,
            "engine": "HuggingFace (toxic-bert)"
        }
    except Exception as err:
        print(f"[Error] Inference failed, running fallback classification: {err}")
        return run_fallback_moderation(text)

def run_fallback_moderation(text: str):
    # Rule-based fallback system in case Hugging Face / PyTorch is not available
    # Matches typical threat patterns, insults, and obscene slang for robust offline demos
    text_lower = text.lower()
    reasons = []
    
    insults = ["loser", "idiot", "stupid", "fool", "brainless", "clown", "dog", "pig", "donkey", "trash", "scum"]
    threats = ["kill", "hurt", "punch", "slap", "beat", "murder", "destroy", "find you"]
    obscenes = ["fuck", "cunt", "shit", "bitch", "asshole", "pussy", "dick"]
    
    for word in insults:
        if word in text_lower:
            reasons.append("insult")
            break
            
    for word in threats:
        if word in text_lower:
            reasons.append("threat")
            break
            
    for word in obscenes:
        if word in text_lower:
            reasons.append("obscene")
            break
            
    return {
        "isToxic": len(reasons) > 0,
        "reasons": reasons,
        "engine": "Cloud Local Fallback (Dictionary)"
    }

if __name__ == "__main__":
    import uvicorn
    # Start server locally on port 8000
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
