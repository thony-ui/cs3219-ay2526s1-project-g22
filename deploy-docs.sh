#!/bin/bash
# Build static Swagger UI
mkdir -p dist
cp docs/api-documentation.yaml dist/
cp docs/api-documentation.html dist/index.html

# Deploy to GitHub Pages
git checkout gh-pages || git checkout -b gh-pages
cp -r dist/* .
git add .
git commit -m "Update API documentation"
git push origin gh-pages
