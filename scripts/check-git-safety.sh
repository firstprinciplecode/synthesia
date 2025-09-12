#!/bin/bash

# Git Safety Check Script
# This script ensures no sensitive files are committed to git

echo "🔒 Git Safety Check"
echo "=================="

# Check if .env files exist and are ignored
echo "📁 Checking .env files..."
if [ -f ".env" ]; then
    if git check-ignore .env >/dev/null 2>&1; then
        echo "✅ .env is properly ignored"
    else
        echo "❌ .env is NOT ignored - DANGER!"
        exit 1
    fi
else
    echo "ℹ️  .env file not found"
fi

# Check for other sensitive files
echo "🔍 Checking for sensitive files..."
sensitive_files=(
    ".env.local"
    ".env.production"
    ".env.development"
    "*.key"
    "*.secret"
    "*.token"
    "*.pem"
)

for pattern in "${sensitive_files[@]}"; do
    for file in $pattern; do
        if [ -f "$file" ]; then
            if git check-ignore "$file" >/dev/null 2>&1; then
                echo "✅ $file is properly ignored"
            else
                echo "❌ $file is NOT ignored - DANGER!"
                exit 1
            fi
        fi
    done
done

# Check what's staged for commit
echo "📋 Checking staged files..."
staged_files=$(git diff --cached --name-only)
if [ -n "$staged_files" ]; then
    echo "Files staged for commit:"
    echo "$staged_files"
    
    # Check if any staged files contain sensitive patterns
    sensitive_patterns=(
        "sk-proj-[a-zA-Z0-9]"
        "sk-ant-[a-zA-Z0-9]"
        "pk_live_[a-zA-Z0-9]"
        "pk_test_[a-zA-Z0-9]"
        "pcsk_[a-zA-Z0-9]"
        "AIzaSy[a-zA-Z0-9]"
        "xai-[a-zA-Z0-9]"
        "Bearer [a-zA-Z0-9]"
    )
    
    # Check for actual secrets (not just words in comments)
    for file in $staged_files; do
        file_content=$(git show ":$file" 2>/dev/null)
        
        # Check for actual API keys/tokens (not just the word "token")
        for pattern in "${sensitive_patterns[@]}"; do
            if echo "$file_content" | grep -q "$pattern" 2>/dev/null; then
                echo "❌ DANGER: $file contains sensitive pattern '$pattern'"
                exit 1
            fi
        done
        
        # Check for actual secrets (look for = followed by value, not just the word)
        if echo "$file_content" | grep -E "^\s*[A-Z_]+_(SECRET|KEY|TOKEN|PASSWORD)\s*=\s*[^[:space:]]" >/dev/null 2>&1; then
            echo "❌ DANGER: $file contains what appears to be actual secret values"
            exit 1
        fi
        
        # Check for long random strings that look like API keys
        # Skip known safe files/lines (e.g., yarn packageManager hash in package.json)
        if [ "$(basename "$file")" != "package.json" ]; then
            if echo "$file_content" | grep -E "[a-zA-Z0-9]{32,}" >/dev/null 2>&1; then
                echo "❌ DANGER: $file contains long random strings that might be API keys"
                exit 1
            fi
        fi
    done
    echo "✅ No sensitive patterns found in staged files"
else
    echo "ℹ️  No files staged for commit"
fi

# Check .gitignore
echo "📝 Checking .gitignore..."
if [ -f ".gitignore" ]; then
    if grep -q "\.env" .gitignore; then
        echo "✅ .env is in .gitignore"
    else
        echo "❌ .env is NOT in .gitignore - DANGER!"
        exit 1
    fi
else
    echo "❌ .gitignore file not found - DANGER!"
    exit 1
fi

echo ""
echo "🎉 All safety checks passed!"
echo "✅ Safe to commit to git"
