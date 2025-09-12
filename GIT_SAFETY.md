# 🔒 Git Safety Guide

This document ensures your sensitive files are NEVER committed to GitHub.

## 🚨 CRITICAL: Never Commit These Files

- `.env` (contains all your API keys and secrets)
- `.env.local`
- `.env.production`
- `*.key`
- `*.secret`
- `*.token`
- `*.pem`

## ✅ What's Protected

### .gitignore Configuration
Our `.gitignore` file protects:
- All `.env*` files
- Sensitive file patterns (`*.key`, `*.secret`, `*.token`)
- Build outputs and temporary files
- OS-generated files

### Safety Scripts
- `scripts/check-git-safety.sh` - Manual safety check
- `.git/hooks/pre-commit` - Automatic pre-commit protection

## 🛡️ How to Stay Safe

### Before Every Commit
1. **Run safety check**: `./scripts/check-git-safety.sh`
2. **Check staged files**: `git status`
3. **Verify no secrets**: `git diff --cached`

### If You Accidentally Stage Sensitive Files
```bash
# Remove from staging
git reset HEAD <filename>

# Add to .gitignore if needed
echo "filename" >> .gitignore

# Commit again
git add .
git commit -m "Your message"
```

### Emergency: If Secrets Were Committed
```bash
# Remove from git history (DANGEROUS - only if absolutely necessary)
git filter-branch --force --index-filter 'git rm --cached --ignore-unmatch .env' --prune-empty --tag-name-filter cat -- --all

# Force push (WARNING: This rewrites history)
git push origin --force --all
```

## 🔍 Current Status

Run `./scripts/check-git-safety.sh` to verify everything is safe.

## 📁 File Structure

```
superagent/
├── .env                 # ❌ NEVER COMMIT (your real secrets)
├── .env 2              # ❌ NEVER COMMIT (backup secrets)
├── env-template.txt    # ✅ SAFE TO COMMIT (template only)
├── .gitignore          # ✅ SAFE TO COMMIT (protection rules)
└── scripts/
    └── check-git-safety.sh  # ✅ SAFE TO COMMIT (safety tool)
```

## 🚀 Safe Commands

```bash
# Check safety before committing
./scripts/check-git-safety.sh

# Safe to commit (only if safety check passes)
git add .
git commit -m "Your changes"
git push origin main
```

## ⚠️ Warning Signs

If you see any of these, STOP and check:
- Files with `.env` in the name
- Files with `key`, `secret`, `token` in the name
- API keys or tokens in `git status` output
- The word "secret" in staged files

## 🆘 Emergency Contacts

If secrets are accidentally committed:
1. **Immediately** revoke all API keys
2. **Immediately** change passwords
3. **Immediately** contact team members
4. Use git history rewriting as last resort

---

**Remember: It's better to be paranoid than to leak secrets!** 🔒
