#!/bin/bash

export GROQ_API_KEY="YOUR_GROQ_API_KEY_HERE"

echo "Testing REAL MemGPT Implementation with Context Window Monitoring..."

# Create a test that will trigger memory pressure by adding many messages
{
  echo "Hello, I'm testing the real MemGPT implementation"
  sleep 2
  echo "Let me tell you a lot about myself to trigger memory pressure"  
  sleep 2
  echo "I work as a software engineer at a tech startup. We're building machine learning applications for healthcare. I specialize in natural language processing and have been working on transformer models for medical text analysis. I enjoy hiking, reading science fiction novels, and cooking Italian food. I have two cats named Pixel and Vector. I live in San Francisco and have been there for 5 years. I studied computer science at Stanford and graduated in 2018."
  sleep 3
  echo "Tell me more about memory management and how you handle context windows"
  sleep 3
  echo "I'm also interested in learning about AI safety, particularly around language models. Do you have any thoughts on alignment research?"
  sleep 3
  echo "/memory"
  sleep 2
  echo "What do you remember about me so far?"
  sleep 3
  echo "/exit"
  sleep 1
} | node cognitron05-memgpt.js