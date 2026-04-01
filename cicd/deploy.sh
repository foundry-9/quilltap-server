#!/bin/bash
set -e  # Exit on error

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account ID: ${AWS_ACCOUNT_ID}"

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com

# Build for production (ARM64 for Fargate cost savings)
echo "Building Docker image for ARM64..."
docker build --platform linux/arm64 --target production -t quilltap .

# Tag and push
echo "Tagging and pushing to ECR..."
docker tag quilltap:latest ${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/quilltap:latest
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/quilltap:latest

echo "Done! Image pushed to ${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/quilltap:latest"

echo "Deploying to ECS..."
aws ecs update-service --cluster quilltap-cluster --service quilltap-dev --force-new-deployment --region us-east-1
echo "Deployment initiated. Check ECS console for status."
