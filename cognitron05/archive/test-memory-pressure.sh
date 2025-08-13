#!/bin/bash

export GROQ_API_KEY="YOUR_GROQ_API_KEY_HERE"

echo "Testing Memory Pressure System - Filling Context Window..."

# Reduce context window to trigger pressure faster
{
  echo "Let's test memory pressure by having a very long detailed conversation that fills up the context window completely."
  sleep 2
  echo "I want to tell you about my entire career history in great detail. I started programming when I was 12 years old, learning BASIC on my father's computer. Then I moved to Pascal in high school, where I won several programming competitions. In college, I studied computer science and learned C++, Java, Python, and JavaScript. My first internship was at Google in 2015, where I worked on search algorithms. Then I interned at Facebook in 2016, working on the news feed ranking system. After graduation, I joined a startup called DataCorp where I built their entire machine learning infrastructure from scratch using TensorFlow and PyTorch."
  sleep 3
  echo "After DataCorp was acquired by Microsoft, I worked there for 3 years on the Azure AI team, specifically on natural language processing models for enterprise customers. I implemented transformer architectures, fine-tuned BERT models, and deployed large-scale ML pipelines handling millions of requests per day. During this time, I also completed a Master's degree part-time at MIT, focusing on AI safety and alignment research. My thesis was on interpretability techniques for large language models."
  sleep 3
  echo "Currently, I'm working at a healthcare AI startup where we're building diagnostic tools that can analyze medical images and text. I lead a team of 8 engineers and data scientists. We use cutting-edge computer vision models, including custom CNN architectures and vision transformers. The regulatory environment in healthcare is complex, so we also work closely with FDA compliance experts. Our models need to be highly accurate and explainable since they're used for patient care decisions."
  sleep 3
  echo "In my free time, I contribute to open source AI projects, particularly focusing on model interpretability and fairness. I've published 15 papers in top-tier conferences like NeurIPS, ICML, and ICLR. I'm also passionate about AI education and mentor junior developers through various programs. I regularly speak at conferences and have given keynote talks at AI Summit and MLConf."
  sleep 3
  echo "My current research interests include multimodal learning, few-shot learning, and developing more efficient training techniques for large models. I'm particularly excited about recent developments in retrieval-augmented generation and how it can improve the factual accuracy of language models while reducing hallucinations."
  sleep 3
  echo "What aspects of my background are you storing in your core memory? I want to make sure you remember the most important parts for our future conversations."
  sleep 4
  echo "/memory"
  sleep 2
  echo "/exit"  
  sleep 1
} | node cognitron05-memgpt.js