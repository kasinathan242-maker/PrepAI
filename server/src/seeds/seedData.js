const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const User = require('../models/User');
const QuestionBank = require('../models/QuestionBank');
const { balanceOptionPositions } = require('../services/aptitudeService');

dotenv.config();

const ROLES = [
  {
    slug: 'software-developer-sde',
    title: 'Software Developer (SDE)',
    category: 'Software Engineering',
    salaryRange: '₹6.5L - ₹18L',
    demandLevel: 'Very High',
    description: 'Designs, develops, tests, and deploys high-concurrency microservices, clean RESTful APIs, and scalable software solutions for modern enterprise tech stacks.',
    skills: ['Data Structures & Algorithms', 'Java / Python / C++', 'System Design', 'DBMS & SQL', 'Git', 'REST APIs'],
    responsibilities: [
      'Write clean, modular, and well-tested code following SOLID principles',
      'Optimize algorithm time and space complexities for large-scale transaction systems',
      'Collaborate in agile sprint rituals, peer code reviews, and architectural reviews'
    ],
    interviewFocus: ['DSA (Dynamic Programming, Graphs, Trees)', 'Object-Oriented Programming (OOP)', 'Low-Level System Design (LLD)', 'Database Indexing & Normalization']
  },
  {
    slug: 'ai-research-engineer',
    title: 'AI Research Engineer',
    category: 'Data & AI',
    salaryRange: '₹14L - ₹32L',
    demandLevel: 'Very High',
    description: 'Pioneers cutting-edge Machine Learning architectures, Large Language Model (LLM) fine-tuning, retrieval-augmented generation (RAG), and deep learning experiments.',
    skills: ['PyTorch / TensorFlow', 'Transformer Architectures', 'Vector Databases (Milvus/Qdrant)', 'Python', 'Linear Algebra & Calculus', 'CUDA / GPU Optimization'],
    responsibilities: [
      'Fine-tune open-weights models (Llama, Mistral) using LoRA / QLoRA techniques',
      'Design high-throughput vector embedding search pipelines and evaluation frameworks',
      'Publish research benchmarks and prototype novel agentic AI workflows'
    ],
    interviewFocus: ['Attention Mechanism & Self-Attention Math', 'Gradient Descent Variants & Regularization', 'Loss Functions & Hallucination Mitigation', 'End-to-End RAG Architecture']
  },
  {
    slug: 'backend-developer',
    title: 'Backend Developer',
    category: 'Software Engineering',
    salaryRange: '₹6L - ₹16L',
    demandLevel: 'High',
    description: 'Builds fault-tolerant server-side systems, distributed caching layers, message queues, and resilient database architectures.',
    skills: ['Node.js / Express', 'Java Spring Boot / Go', 'PostgreSQL / MongoDB', 'Redis Caching', 'Kafka / RabbitMQ', 'Docker'],
    responsibilities: [
      'Develop secure, authenticated microservices utilizing JWT, OAuth2, and rate-limiting',
      'Maintain database migrations, connection pooling, and complex SQL query optimization',
      'Implement asynchronous job queues for high-volume background processing'
    ],
    interviewFocus: ['Concurrency & Thread Safety', 'ACID Transactions & Database Isolation Levels', 'API Gateway Design & Rate Limiting', 'Event-Driven Architecture']
  },
  {
    slug: 'frontend-developer',
    title: 'Frontend Developer',
    category: 'Software Engineering',
    salaryRange: '₹5.5L - ₹15L',
    demandLevel: 'High',
    description: 'Crafts lightning-fast, visually stunning, accessible, and responsive user interfaces using modern reactive web frameworks.',
    skills: ['React 19 / Next.js', 'TypeScript', 'Tailwind CSS', 'State Management (Zustand/Redux)', 'Web Performance & Core Web Vitals', 'Accessibility (WCAG)'],
    responsibilities: [
      'Translate UI/UX Figma design systems into pixel-perfect, interactive components',
      'Optimize asset bundles, rendering lifecycles, and client-side caching',
      'Write end-to-end integration tests using Playwright and Vitest'
    ],
    interviewFocus: ['React Fiber & Reconciliation Engine', 'Browser Event Loop & Macro/Microtasks', 'CSS Grid/Flexbox Layout Mechanics', 'Frontend State Architecture & Custom Hooks']
  },
  {
    slug: 'full-stack-developer',
    title: 'Full-Stack Developer',
    category: 'Software Engineering',
    salaryRange: '₹6L - ₹16L',
    demandLevel: 'Very High',
    description: 'Owns end-to-end feature delivery spanning dynamic frontend interfaces, backend application logic, and cloud database integrations.',
    skills: ['MERN Stack (MongoDB, Express, React, Node.js)', 'TypeScript', 'REST & GraphQL', 'Tailwind CSS', 'CI/CD Pipelines', 'AWS S3 / Cloud Deployment'],
    responsibilities: [
      'Deliver features from database schema design all the way to customer-facing UI',
      'Implement real-time WebSockets / Server-Sent Events for reactive collaboration',
      'Oversee automated testing, containerized Docker builds, and deployment verification'
    ],
    interviewFocus: ['End-to-End System Flow', 'State Hydration & Client-Server Synchronization', 'Authentication Patterns', 'Database Schema Modeling']
  },
  {
    slug: 'machine-learning-engineer',
    title: 'Machine Learning Engineer',
    category: 'Data & AI',
    salaryRange: '₹10L - ₹22L',
    demandLevel: 'High',
    description: 'Bridges data science models and production software engineering by building robust MLOps, CI/CD, and real-time inference pipelines.',
    skills: ['Python', 'Scikit-Learn / PyTorch', 'MLflow / Kubeflow', 'Docker & Kubernetes', 'Feature Store (Feast)', 'FastAPI / Triton Inference'],
    responsibilities: [
      'Package and deploy ML models as low-latency microservices',
      'Establish automated model monitoring for data drift and concept drift',
      'Design distributed training pipelines on cloud clusters'
    ],
    interviewFocus: ['ML System Design', 'Model Metrics (ROC-AUC, Precision-Recall)', 'Data Drift Detection Strategies', 'Model Quantization & Inference Latency']
  },
  {
    slug: 'data-scientist',
    title: 'Data Scientist',
    category: 'Data & AI',
    salaryRange: '₹8.5L - ₹20L',
    demandLevel: 'High',
    description: 'Discovers hidden business opportunities through exploratory data analysis, hypothesis testing, clustering, and predictive statistical modeling.',
    skills: ['Python / R', 'Pandas & NumPy', 'Statistical Inference & Hypothesis Testing', 'Machine Learning Algorithms', 'SQL', 'Data Storytelling'],
    responsibilities: [
      'Formulate statistical experiments and A/B test methodologies',
      'Build customer lifetime value, churn prediction, and recommendation algorithms',
      'Present executive data narratives to senior leadership stakeholders'
    ],
    interviewFocus: ['Probability & Bayes Theorem', 'A/B Test Sample Size & P-Value Interpretation', 'Feature Engineering Strategies', 'Business Case Analysis']
  },
  {
    slug: 'data-engineer',
    title: 'Data Engineer',
    category: 'Data & AI',
    salaryRange: '₹7.5L - ₹17L',
    demandLevel: 'High',
    description: 'Constructs reliable streaming and batch ETL pipelines, distributed data warehouses, and modern lakehouse architectures.',
    skills: ['Apache Spark / PySpark', 'SQL & Data Warehousing (Snowflake/BigQuery)', 'Apache Kafka', 'Airflow Orchestration', 'Python / Scala', 'Delta Lake'],
    responsibilities: [
      'Architect petabyte-scale data pipelines ensuring high data quality and schema validation',
      'Optimize analytical SQL query performance and data partitioning strategies',
      'Manage data governance, lineage tracking, and automated pipeline alerting'
    ],
    interviewFocus: ['MapReduce Paradigms & Spark Shuffling', 'Data Modeling (Star Schema vs Snowflake)', 'Kafka Partitioning & Offset Management', 'Idempotent Pipeline Design']
  },
  {
    slug: 'data-analyst',
    title: 'Data Analyst',
    category: 'Data & AI',
    salaryRange: '₹5L - ₹12L',
    demandLevel: 'Moderate',
    description: 'Translates complex enterprise datasets into actionable executive dashboards, KPIs, and structured analytical reports.',
    skills: ['Advanced SQL (Window Functions, CTEs)', 'Power BI / Tableau', 'Excel & VBA', 'Python Data Wrangling', 'Metric Definition & KPI Modeling'],
    responsibilities: [
      'Build and automate operational business dashboards for cross-functional teams',
      'Analyze root causes behind product engagement drops and revenue trends',
      'Perform data auditing and ensure single-source-of-truth metric integrity'
    ],
    interviewFocus: ['SQL Window Functions & Joins', 'Dashboard UI/UX Principles', 'Metric Decomposition & Root Cause Analysis', 'Cohort Analysis']
  },
  {
    slug: 'cloud-engineer',
    title: 'Cloud Engineer',
    category: 'Specialized',
    salaryRange: '₹7L - ₹17L',
    demandLevel: 'High',
    description: 'Designs, deploys, and maintains multi-region cloud infrastructures, networking topology, IAM security, and auto-scaling architectures.',
    skills: ['AWS / Azure / GCP', 'Infrastructure as Code (Terraform)', 'VPC, Subnets & Route Tables', 'IAM Policies & Security Groups', 'Linux Administration', 'CloudWatch / Datadog'],
    responsibilities: [
      'Automate immutable cloud infrastructure provisioning using Terraform scripts',
      'Architect zero-downtime multi-AZ failover and disaster recovery architectures',
      'Implement cloud FinOps cost optimization and right-sizing initiatives'
    ],
    interviewFocus: ['Cloud Security Best Practices', 'CIDR Blocks & VPC Peering / NAT Gateways', 'Load Balancers & Auto-Scaling Groups', 'Disaster Recovery RTO/RPO']
  },
  {
    slug: 'sre-devops-engineer',
    title: 'SRE / DevOps Engineer',
    category: 'Software Engineering',
    salaryRange: '₹7.5L - ₹18L',
    demandLevel: 'High',
    description: 'Empowers developer velocity while guaranteeing 99.99% infrastructure reliability through Kubernetes, CI/CD automation, and observability.',
    skills: ['Kubernetes & Helm', 'Docker', 'GitHub Actions / Jenkins', 'Prometheus & Grafana', 'Bash / Python Scripting', 'Incident Management (SLO/SLI)'],
    responsibilities: [
      'Build automated multi-stage CI/CD deployment pipelines with zero downtime',
      'Maintain Kubernetes clusters, ingress controllers, and auto-scalers (HPA/KEDA)',
      'Conduct post-mortem incident analyses and automate self-healing infrastructure'
    ],
    interviewFocus: ['Kubernetes Pod Lifecycle & Networking', 'Blue-Green vs Canary Deployments', 'Defining SLI, SLO, and Error Budgets', 'Linux Troubleshooting & System Calls']
  },
  {
    slug: 'cybersecurity-analyst',
    title: 'Cybersecurity Analyst',
    category: 'Specialized',
    salaryRange: '₹7L - ₹16L',
    demandLevel: 'High',
    description: 'Protects enterprise digital assets through continuous threat hunting, vulnerability assessments, penetration testing, and SOC monitoring.',
    skills: ['Network Security & Wireshark', 'OWASP Top 10', 'SIEM Tools (Splunk)', 'Penetration Testing (Kali, Burp Suite)', 'Cryptography & PKI', 'SOC Protocols'],
    responsibilities: [
      'Monitor real-time intrusion attempts and orchestrate swift incident response',
      'Perform periodic security code audits and web application penetration tests',
      'Enforce zero-trust architecture and compliance regulations (ISO 27001, SOC2)'
    ],
    interviewFocus: ['OWASP Web Vulnerabilities (SQLi, XSS, CSRF)', 'TCP/IP Handshake & Packet Inspection', 'Public Key Cryptography & SSL/TLS', 'Ransomware Mitigation Steps']
  },
  {
    slug: 'qa-sdet',
    title: 'QA / SDET',
    category: 'Software Engineering',
    salaryRange: '₹5L - ₹13L',
    demandLevel: 'Moderate',
    description: 'Champions product reliability by building end-to-end test automation frameworks, stress testing suites, and quality gates in CI/CD.',
    skills: ['Playwright / Cypress / Selenium', 'Test Frameworks (Jest, JUnit, PyTest)', 'API Testing (Postman / REST Assured)', 'Performance Testing (k6 / JMeter)', 'CI/CD Integration'],
    responsibilities: [
      'Architect robust, flakiness-free end-to-end automated testing suites',
      'Execute continuous performance, soak, and load testing simulations',
      'Establish test coverage thresholds and block buggy releases prior to staging'
    ],
    interviewFocus: ['Test Automation Architecture & Page Object Model', 'Boundary Value Analysis & Equivalence Partitioning', 'API Mocking & Contract Testing', 'Bug Triage & Root Cause Analysis']
  },
  {
    slug: 'mobile-developer',
    title: 'Mobile Developer',
    category: 'Specialized',
    salaryRange: '₹5.5L - ₹15L',
    demandLevel: 'Moderate',
    description: 'Designs responsive, battery-efficient mobile applications with fluid 60fps animations for iOS and Android ecosystems.',
    skills: ['React Native / Flutter', 'Kotlin / Swift', 'Mobile State Management', 'Offline Storage & SQLite', 'App Store / Play Store Deployment', 'Push Notifications'],
    responsibilities: [
      'Build native bridge components and hardware integrations (Camera, GPS, Biometrics)',
      'Optimize frame rates, memory footprints, and offline data synchronization',
      'Manage app certification, code signing, and store release tracks'
    ],
    interviewFocus: ['Mobile Memory Management & Garbage Collection', 'Offline-First Architecture & Sync Conflict Resolution', 'Mobile App Security & Keystore Storage', 'Deep Linking & Navigation']
  },
  {
    slug: 'embedded-engineer',
    title: 'Embedded Engineer',
    category: 'Specialized',
    salaryRange: '₹5L - ₹14L',
    demandLevel: 'Moderate',
    description: 'Programs microcontrollers, Real-Time Operating Systems (RTOS), and hardware communication buses for smart devices and IoT systems.',
    skills: ['Embedded C / C++', 'RTOS (FreeRTOS)', 'Communication Protocols (I2C, SPI, UART, CAN)', 'Microcontrollers (ARM Cortex, ESP32)', 'Hardware Debugging (Oscilloscope, Logic Analyzer)'],
    responsibilities: [
      'Write low-level device drivers and hardware abstraction layers (HAL)',
      'Optimize code for constrained memory, flash storage, and battery consumption',
      'Verify timing guarantees and manage hardware interrupt service routines (ISR)'
    ],
    interviewFocus: ['Interrupt Latency & Critical Sections', 'Memory Management in Constrained Systems', 'Serial Protocols Protocol Timing (I2C vs SPI)', 'Bitwise Manipulation & Registers']
  },
  {
    slug: 'product-manager',
    title: 'Product Manager',
    category: 'Management',
    salaryRange: '₹9L - ₹22L',
    demandLevel: 'High',
    description: 'Drives the product vision from inception to market launch by aligning customer empathy, engineering viability, and corporate business strategy.',
    skills: ['Product Strategy & Roadmap Planning', 'PRD & Feature Specification', 'User Research & Wireframing', 'Data Analytics (Mixpanel/Amplitude)', 'Agile / Scrum Methodologies'],
    responsibilities: [
      'Define quarterly OKRs, product backlogs, and prioritize feature epics',
      'Synthesize user feedback and usage funnels to eliminate adoption drop-offs',
      'Lead cross-functional sprints across engineering, design, marketing, and sales'
    ],
    interviewFocus: ['Product Design Case Study', 'Prioritization Frameworks (RICE, Kano)', 'Metric Definition & North Star Metrics', 'Product Teardown & Growth Tactics']
  },
  {
    slug: 'business-analyst',
    title: 'Business Analyst',
    category: 'Management',
    salaryRange: '₹5L - ₹13L',
    demandLevel: 'Moderate',
    description: 'Translates high-level enterprise business requirements into structured functional technical requirements, user stories, and acceptance criteria.',
    skills: ['BRD & FRD Documentation', 'Jira & Confluence', 'UML Diagrams & Flowcharts', 'SQL & Data Extraction', 'Stakeholder Management & Negotiation'],
    responsibilities: [
      'Conduct requirement gathering workshops with enterprise business leaders',
      'Create detailed process mapping flowcharts and use-case specifications',
      'Perform user acceptance testing (UAT) and support go-live change management'
    ],
    interviewFocus: ['Requirement Elicitation Techniques', 'Conflict Resolution with Stakeholders', 'Agile User Story Writing & INVEST Criteria', 'Process Flow Optimization']
  },
  {
    slug: 'program-manager',
    title: 'Program Manager',
    category: 'Management',
    salaryRange: '₹10L - ₹24L',
    demandLevel: 'Moderate',
    description: 'Orchestrates multi-team strategic technology programs, tracking cross-project dependencies, executive milestones, budget adherence, and risk mitigation.',
    skills: ['Cross-Functional Leadership', 'Risk Management & Mitigation', 'Program Governance & RACI Matrices', 'Resource & Budget Planning', 'Executive Communication'],
    responsibilities: [
      'Track critical path milestones across multiple engineering teams',
      'Anticipate technical and resource bottlenecks and resolve cross-team blockers',
      'Deliver weekly program health status dashboards to executive committees'
    ],
    interviewFocus: ['Managing Ambiguity and Conflicting Priorities', 'Risk Matrix Creation & Mitigation Playbooks', 'Stakeholder Communication Matrix', 'Handling Scope Creep']
  },
  {
    slug: 'consulting-analyst',
    title: 'Consulting Analyst',
    category: 'Management',
    salaryRange: '₹7.5L - ₹18L',
    demandLevel: 'High',
    description: 'Advises global enterprise clients on digital transformation, technology adoption, cost reduction, and modern IT operational strategies.',
    skills: ['Strategic Problem Solving (MECE Framework)', 'Financial Modeling & Valuation', 'Executive Presentations & Decks', 'Market Sizing (Guesstimates)', 'Industry Benchmarking'],
    responsibilities: [
      'Conduct rigorous market research and financial analysis on client operations',
      'Build structured financial models to evaluate ROI on technology migrations',
      'Deliver high-impact consulting presentations to client C-suite executives'
    ],
    interviewFocus: ['Management Consulting Case Interviews', 'MECE Principle & Issue Trees', 'Market Sizing & Profitability Frameworks', 'Slide Deck Storylining']
  },
  {
    slug: 'ui-ux-designer',
    title: 'UI/UX Designer',
    category: 'Specialized',
    salaryRange: '₹5L - ₹14L',
    demandLevel: 'Moderate',
    description: 'Transforms complex workflows into intuitive, elegant, human-centric visual interfaces and unified design systems.',
    skills: ['Figma / FigJam', 'Design Systems & Component Libraries', 'Wireframing & Prototyping', 'User Research & Usability Testing', 'Typography, Color Theory & Micro-interactions'],
    responsibilities: [
      'Conduct user interviews, persona creation, and journey mapping studies',
      'Build scalable atomic design systems with tokens and reusable variants in Figma',
      'Collaborate closely with frontend engineers to ensure design implementation fidelity'
    ],
    interviewFocus: ['Design Portfolio Walkthrough', 'Design System Architecture', 'User Journey Mapping & Usability Heuristics', 'Balancing Aesthetics with Technical Constraints']
  }
];

const COMPANIES = [
  {
    slug: 'tcs',
    name: 'Tata Consultancy Services (TCS)',
    category: 'IT Services & Consulting',
    ctcRange: '₹3.6L - ₹12L (Ninja, Digital, Prime)',
    status: 'active',
    description: 'TCS National Qualifier Test (NQT): Round 1 Foundation Section (Cognitive) + Round 2 Advanced Section (Quant & Coding). Followed by 2 Technical & HR interview rounds.',
    assessmentPattern: {
      totalQuestions: 82,
      totalMinutes: 165,
      totalSections: 5,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Numerical Ability', questions: 20, durationMinutes: 25, topics: ['Percentages', 'Time & Work', 'Profit & Loss', 'Ratios'] },
        { name: 'Verbal Ability', questions: 25, durationMinutes: 25, topics: ['Sentence Completion', 'Para Jumbles', 'Vocabulary'] },
        { name: 'Reasoning Ability', questions: 20, durationMinutes: 25, topics: ['Data Sufficiency', 'Coding Decoding', 'Blood Relations'] },
        { name: 'Advanced Quantitative', questions: 15, durationMinutes: 35, topics: ['Permutations & Combinations', 'Probability', 'Geometry'] },
        { name: 'Hands-on Coding', questions: 2, durationMinutes: 55, topics: ['Arrays', 'Strings Manipulation', 'Matrix Transformation'] }
      ],
      difficultyDistribution: { easy: 35, medium: 50, hard: 15 },
      negativeMarking: '0.25 on Foundation MCQs'
    }
  },
  {
    slug: 'infosys',
    name: 'Infosys Limited',
    category: 'IT Services & Consulting',
    ctcRange: '₹4.0L - ₹14L (SE, DSE, Specialist Programmer)',
    status: 'active',
    description: 'Infosys Campus & InfyTQ Challenge: Rigorous assessment covering Mathematical, Analytical, and Data Structures coding challenge, followed by Technical & HR rounds.',
    assessmentPattern: {
      totalQuestions: 54,
      totalMinutes: 100,
      totalSections: 4,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Reasoning Ability', questions: 15, durationMinutes: 25, topics: ['Critical Reasoning', 'Data Arrangement', 'Syllogisms'] },
        { name: 'Technical Ability', questions: 10, durationMinutes: 35, topics: ['Data Structures', 'OOP Concepts', 'DBMS Queries'] },
        { name: 'Verbal Ability', questions: 20, durationMinutes: 20, topics: ['Grammar', 'Reading Comprehension', 'Sentence Correction'] },
        { name: 'Hands-on Coding', questions: 3, durationMinutes: 90, topics: ['Dynamic Programming', 'Greedy Algorithms', 'Strings'] }
      ],
      difficultyDistribution: { easy: 30, medium: 50, hard: 20 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'wipro',
    name: 'Wipro Limited',
    category: 'IT Services & Consulting',
    ctcRange: '₹3.5L - ₹11L (Elite & Turbo)',
    status: 'active',
    description: 'Wipro Elite NLTH: Foundational Aptitude (Quant, Logical, Verbal), Written Communication (Essay), and Hands-on Coding.',
    assessmentPattern: {
      totalQuestions: 52,
      totalMinutes: 128,
      totalSections: 3,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Aptitude Test', questions: 48, durationMinutes: 48, topics: ['Quantitative', 'Logical Reasoning', 'Verbal English'] },
        { name: 'Written Communication', questions: 1, durationMinutes: 20, topics: ['Business Email / Essay Writing'] },
        { name: 'Coding Round', questions: 2, durationMinutes: 60, topics: ['Strings', 'Array Sorting', 'Recursion'] }
      ],
      difficultyDistribution: { easy: 40, medium: 45, hard: 15 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'hcltech',
    name: 'HCLTech',
    category: 'IT Services & Engineering',
    ctcRange: '₹4.25L - ₹12L',
    status: 'active',
    description: 'HCL First Careers Drive: Analytical Reasoning, Quantitative, English Communication, Core CS Technical MCQs, and Coding test.',
    assessmentPattern: {
      totalQuestions: 60,
      totalMinutes: 90,
      totalSections: 4,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Quantitative & Aptitude', questions: 20, durationMinutes: 30, topics: ['Number Series', 'Algebra', 'Speed Distance'] },
        { name: 'Logical & Reasoning', questions: 20, durationMinutes: 25, topics: ['Puzzles', 'Analogies', 'Direction Sense'] },
        { name: 'CS Technical MCQs', questions: 18, durationMinutes: 25, topics: ['C / C++ Basics', 'OOP', 'Data Structures'] },
        { name: 'Coding Challenge', questions: 2, durationMinutes: 30, topics: ['Basic Algorithms', 'Array Searching'] }
      ],
      difficultyDistribution: { easy: 45, medium: 45, hard: 10 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'tech-mahindra',
    name: 'Tech Mahindra',
    category: 'IT Services & Telecom',
    ctcRange: '₹3.8L - ₹10L',
    status: 'active',
    description: 'Tech Mahindra Campus Hiring: English Language Assessment, Aptitude Test, Automata Fix (Debugging), and Technical Interview.',
    assessmentPattern: {
      totalQuestions: 75,
      totalMinutes: 100,
      totalSections: 4,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'English Essay & Grammar', questions: 30, durationMinutes: 30, topics: ['Grammar', 'Paragraph Correction'] },
        { name: 'Aptitude & Analytical', questions: 30, durationMinutes: 35, topics: ['Logical Reasoning', 'Math Problems'] },
        { name: 'Automata Fix Debugging', questions: 7, durationMinutes: 20, topics: ['Syntax Debugging', 'Logical Bug Fixing'] },
        { name: 'Coding Assessment', questions: 2, durationMinutes: 45, topics: ['Array Traversal', 'Pattern Printing'] }
      ],
      difficultyDistribution: { easy: 40, medium: 50, hard: 10 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'ltimindtree',
    name: 'LTIMindtree',
    category: 'Digital Transformation & IT',
    ctcRange: '₹4.5L - ₹13.5L',
    status: 'active',
    description: 'LTIMindtree Sparks Drive: Aptitude, Technical MCQs (OS, DBMS, Cloud), Pseudocode evaluation, and Coding.',
    assessmentPattern: {
      totalQuestions: 65,
      totalMinutes: 110,
      totalSections: 4,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Quantitative & Logical', questions: 30, durationMinutes: 40, topics: ['Probability', 'Time & Distance', 'Logical Series'] },
        { name: 'Verbal Ability', questions: 15, durationMinutes: 20, topics: ['Reading Comprehension', 'Sentence Correction'] },
        { name: 'Computer Science MCQs', questions: 18, durationMinutes: 25, topics: ['OS Deadlocks', 'SQL Queries', 'OOP Principles'] },
        { name: 'Coding Round', questions: 2, durationMinutes: 45, topics: ['Matrix Operations', 'String Parsing'] }
      ],
      difficultyDistribution: { easy: 35, medium: 45, hard: 20 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'zoho',
    name: 'Zoho Corporation',
    category: 'Enterprise SaaS & Cloud',
    ctcRange: '₹6L - ₹16L',
    status: 'active',
    description: 'Zoho Recruitment: Round 1 General Aptitude & C Output Puzzles + Round 2 Basic Programming + Round 3 Complex System Design / App Logic + Round 4 Tech Interview + Round 5 HR.',
    assessmentPattern: {
      totalQuestions: 35,
      totalMinutes: 150,
      totalSections: 3,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'General Aptitude & C Puzzles', questions: 25, durationMinutes: 60, topics: ['Math Puzzles', 'Pointers Output', 'Flowcharts'] },
        { name: 'Basic Programming', questions: 5, durationMinutes: 45, topics: ['Pattern Printing', 'Substrings', 'Arrays'] },
        { name: 'Advanced System Logic', questions: 5, durationMinutes: 45, topics: ['Recursion', 'Matrix Operations', 'Mini-App Logic'] }
      ],
      difficultyDistribution: { easy: 25, medium: 50, hard: 25 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'cognizant',
    name: 'Cognizant India',
    category: 'IT Services & Consulting',
    ctcRange: '₹4.2L - ₹12L (GenC, GenC Next, GenC Pro)',
    status: 'active',
    description: 'Cognizant GenC Drive: Quantitative, Analytical, Automata Fix (Debugging), and Hands-on Coding assessment.',
    assessmentPattern: {
      totalQuestions: 50,
      totalMinutes: 120,
      totalSections: 4,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Quantitative Ability', questions: 16, durationMinutes: 20, topics: ['Ratios', 'Percentages', 'Algebra'] },
        { name: 'Analytical Reasoning', questions: 14, durationMinutes: 20, topics: ['Syllogisms', 'Logical Sequences'] },
        { name: 'Automata Fix', questions: 7, durationMinutes: 20, topics: ['Syntax Errors', 'Algorithm Bugs'] },
        { name: 'Coding Challenge', questions: 2, durationMinutes: 60, topics: ['Data Structures', 'String Manipulation'] }
      ],
      difficultyDistribution: { easy: 40, medium: 45, hard: 15 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'persistent',
    name: 'Persistent Systems',
    category: 'Product Engineering & Digital',
    ctcRange: '₹5L - ₹14L',
    status: 'active',
    description: 'Persistent Systems Drive: Objective CS Assessment (OS, DBMS, CN), Advanced Algorithmic Coding, and Domain Technical Interviews.',
    assessmentPattern: {
      totalQuestions: 45,
      totalMinutes: 90,
      totalSections: 3,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'CS Core Fundamentals', questions: 25, durationMinutes: 30, topics: ['OS Concepts', 'DBMS Queries', 'Computer Networks'] },
        { name: 'Quantitative & Logical', questions: 18, durationMinutes: 25, topics: ['Combinatorics', 'Data Interpretation'] },
        { name: 'Coding Challenge', questions: 2, durationMinutes: 45, topics: ['Trees', 'Graphs', 'Hash Tables'] }
      ],
      difficultyDistribution: { easy: 25, medium: 50, hard: 25 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'accenture',
    name: 'Accenture India',
    category: 'Consulting & Technology',
    ctcRange: '₹4.6L - ₹12.5L (ASE & FSE)',
    status: 'active',
    description: 'Accenture Cognitive and Technical Assessment: Cognitive ability, Technical MCQs, Pseudocode, and Automated Coding.',
    assessmentPattern: {
      totalQuestions: 90,
      totalMinutes: 90,
      totalSections: 3,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Cognitive Ability', questions: 50, durationMinutes: 50, topics: ['English', 'Critical Reasoning', 'Abstract Logic'] },
        { name: 'Technical Assessment', questions: 40, durationMinutes: 40, topics: ['Pseudo Code', 'Cloud Basics', 'Network Security'] },
        { name: 'Coding Assessment', questions: 2, durationMinutes: 45, topics: ['Array Sorting', 'Mathematical Functions'] }
      ],
      difficultyDistribution: { easy: 40, medium: 50, hard: 10 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'capgemini',
    name: 'Capgemini India',
    category: 'IT & Digital Services',
    ctcRange: '₹4.25L - ₹10L (Exceller Drive)',
    status: 'active',
    description: 'Capgemini Exceller Drive: Pseudocode challenge, English communication, Game-based aptitude, and Technical Interview.',
    assessmentPattern: {
      totalQuestions: 60,
      totalMinutes: 100,
      totalSections: 4,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Pseudocode Challenge', questions: 30, durationMinutes: 30, topics: ['Recursion Output', 'Bitwise Operators'] },
        { name: 'English Communication', questions: 30, durationMinutes: 30, topics: ['Sentence Correction', 'Vocabulary'] },
        { name: 'Game-Based Aptitude', questions: 4, durationMinutes: 24, topics: ['Inductive Reasoning', 'Grid Challenge'] }
      ],
      difficultyDistribution: { easy: 35, medium: 50, hard: 15 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'oracle',
    name: 'Oracle India',
    category: 'Enterprise Cloud & Software',
    ctcRange: '₹8L - ₹22L',
    status: 'active',
    description: 'Oracle Campus Hiring: CS fundamentals (OS, DBMS, OOP), Quant, and Coding problems followed by 3 rounds of technical interviews.',
    assessmentPattern: {
      totalQuestions: 40,
      totalMinutes: 105,
      totalSections: 3,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'CS Fundamentals', questions: 25, durationMinutes: 40, topics: ['OS Deadlocks', 'SQL Queries', 'Binary Trees'] },
        { name: 'Quantitative & Reasoning', questions: 15, durationMinutes: 25, topics: ['Probability', 'Combinatorics'] },
        { name: 'Hands-on Coding', questions: 2, durationMinutes: 40, topics: ['Hash Maps', 'Graph Traversals'] }
      ],
      difficultyDistribution: { easy: 20, medium: 55, hard: 25 },
      negativeMarking: '0.25 on MCQs'
    }
  },
  {
    slug: 'amazon',
    name: 'Amazon',
    category: 'Product & Cloud Services',
    ctcRange: '₹14L - ₹45L',
    status: 'active',
    description: 'Amazon Campus Recruitment: Online Assessment (Coding + Work Simulation / Leadership Principles) + 3 Technical Rounds + Bar Raiser.',
    assessmentPattern: {
      totalQuestions: 32,
      totalMinutes: 105,
      totalSections: 3,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Coding Assessment', questions: 2, durationMinutes: 70, topics: ['Data Structures', 'Dynamic Programming', 'Trees & Graphs'] },
        { name: 'Work Style Simulation', questions: 25, durationMinutes: 20, topics: ['Customer Obsession', 'Ownership', 'Bias for Action'] },
        { name: 'Technical Logic & Reasoning', questions: 5, durationMinutes: 15, topics: ['Complexity Analysis', 'System Scalability'] }
      ],
      difficultyDistribution: { easy: 10, medium: 60, hard: 30 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'freshworks',
    name: 'Freshworks Inc.',
    category: 'Enterprise SaaS & Cloud',
    ctcRange: '₹8L - ₹20L',
    status: 'active',
    description: 'Freshworks Campus Drive: Round 1 Technical Aptitude & Coding + Round 2 Problem Solving & Data Structures + Round 3 System Architecture & Cultural Alignment.',
    assessmentPattern: {
      totalQuestions: 30,
      totalMinutes: 90,
      totalSections: 3,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'CS Fundamentals & Aptitude', questions: 20, durationMinutes: 30, topics: ['OOP', 'DBMS Normalization', 'Computer Networks'] },
        { name: 'Core Coding Challenge', questions: 2, durationMinutes: 45, topics: ['Arrays', 'Strings', 'Hash Maps'] },
        { name: 'System Logic & API Design', questions: 8, durationMinutes: 15, topics: ['RESTful APIs', 'Authentication', 'Cache Design'] }
      ],
      difficultyDistribution: { easy: 25, medium: 55, hard: 20 },
      negativeMarking: 'none'
    }
  },
  {
    slug: 'hexaware',
    name: 'Hexaware Technologies',
    category: 'IT Services & Automation',
    ctcRange: '₹4.0L - ₹10L (PGET)',
    status: 'active',
    description: 'Hexaware Premier Graduate Engineer Trainee (PGET): Aptitude, Domain Technical MCQs, Automated Communication Assessment, and Coding Challenge.',
    assessmentPattern: {
      totalQuestions: 60,
      totalMinutes: 90,
      totalSections: 4,
      sectionalCutoff: 'yes',
      sections: [
        { name: 'Quantitative & Logical', questions: 25, durationMinutes: 30, topics: ['Time & Work', 'Percentages', 'Puzzles'] },
        { name: 'Technical CS MCQs', questions: 20, durationMinutes: 25, topics: ['Data Structures', 'SQL Queries', 'Java / Python'] },
        { name: 'Coding Assessment', questions: 2, durationMinutes: 25, topics: ['Array Traversal', 'String Formatting'] },
        { name: 'Communication Evaluation', questions: 13, durationMinutes: 10, topics: ['Grammar', 'Fluency', 'Listening'] }
      ],
      difficultyDistribution: { easy: 40, medium: 45, hard: 15 },
      negativeMarking: 'none'
    }
  }
];

const QUESTIONS = [
  // Quantitative
  {
    category: 'Quantitative',
    subCategory: 'Time & Work',
    difficulty: 'easy',
    questionText: 'A can complete a task in 12 days and B can complete it in 24 days. Working together, in how many days will they finish the task?',
    options: ['6 days', '8 days', '10 days', '18 days'],
    correctAnswer: '8 days',
    explanation: 'Work done by A in 1 day = 1/12. Work done by B in 1 day = 1/24. Combined work per day = 1/12 + 1/24 = 3/24 = 1/8. Total days = 8 days.',
    companyTags: ['tcs', 'cognizant', 'accenture', 'infosys']
  },
  {
    category: 'Quantitative',
    subCategory: 'Percentages & Profit',
    difficulty: 'easy',
    questionText: 'A laptop originally priced at ₹50,000 is discounted by 20% during a sale. What is the final selling price?',
    options: ['₹38,000', '₹40,000', '₹42,000', '₹45,000'],
    correctAnswer: '₹40,000',
    explanation: 'Discount = 20% of 50,000 = ₹10,000. Selling Price = 50,000 - 10,000 = ₹40,000.',
    companyTags: ['tcs', 'wipro', 'capgemini']
  },
  {
    category: 'Quantitative',
    subCategory: 'Time, Speed & Distance',
    difficulty: 'medium',
    questionText: 'A train 180 meters long is traveling at a speed of 54 km/h. How many seconds will it take to pass a stationary pole?',
    options: ['8 seconds', '10 seconds', '12 seconds', '15 seconds'],
    correctAnswer: '12 seconds',
    explanation: 'Speed in m/s = 54 * (5/18) = 15 m/s. Time = Distance / Speed = 180 / 15 = 12 seconds.',
    companyTags: ['tcs', 'infosys', 'zoho']
  },
  {
    category: 'Quantitative',
    subCategory: 'Probability',
    difficulty: 'medium',
    questionText: 'Two dice are rolled simultaneously. What is the probability of obtaining a sum equal to 8?',
    options: ['5/36', '1/6', '7/36', '1/9'],
    correctAnswer: '5/36',
    explanation: 'Total outcomes = 36. Favorable outcomes: (2,6), (3,5), (4,4), (5,3), (6,2) -> 5 outcomes. Probability = 5/36.',
    companyTags: ['amazon', 'oracle', 'infosys']
  },
  {
    category: 'Quantitative',
    subCategory: 'Permutations & Combinations',
    difficulty: 'hard',
    questionText: 'In how many distinct ways can 5 boys and 4 girls be seated in a row such that no two girls are seated next to each other?',
    options: ['43,200', '28,800', '120,960', '86,400'],
    correctAnswer: '43,200',
    explanation: 'Seat 5 boys first in 5! = 120 ways. This creates 6 available gaps for girls. Choose 4 gaps in 6P4 ways = 6 * 5 * 4 * 3 = 360. Total arrangements = 120 * 360 = 43,200.',
    companyTags: ['amazon', 'google', 'oracle']
  },

  // Logical Reasoning
  {
    category: 'Logical Reasoning',
    subCategory: 'Series & Patterns',
    difficulty: 'easy',
    questionText: 'Find the next number in the sequence: 4, 9, 19, 39, 79, ?',
    options: ['119', '139', '159', '169'],
    correctAnswer: '159',
    explanation: 'The pattern is: x * 2 + 1. (4*2+1=9, 9*2+1=19, 19*2+1=39, 39*2+1=79, 79*2+1=159).',
    companyTags: ['tcs', 'cognizant', 'zoho']
  },
  {
    category: 'Logical Reasoning',
    subCategory: 'Syllogisms',
    difficulty: 'medium',
    questionText: 'Statements: All developers are engineers. Some engineers are designers. Conclusions: I. Some developers are designers. II. All engineers are developers.',
    options: ['Only I follows', 'Only II follows', 'Both I and II follow', 'Neither I nor II follows'],
    correctAnswer: 'Neither I nor II follows',
    explanation: 'Developers are a subset of engineers, and only some engineers are designers. There is no guaranteed overlap between developers and designers, so neither conclusion is definite.',
    companyTags: ['accenture', 'infosys', 'capgemini']
  },
  {
    category: 'Logical Reasoning',
    subCategory: 'Blood Relations',
    difficulty: 'medium',
    questionText: 'Pointing to a portrait, Priya says, "He is the son of the only daughter of my paternal grandfather." How is the boy related to Priya?',
    options: ['Cousin', 'Brother', 'Uncle', 'Nephew'],
    correctAnswer: 'Cousin',
    explanation: 'Paternal grandfather\'s only daughter is Priya\'s paternal aunt (father\'s sister). The son of Priya\'s aunt is Priya\'s cousin.',
    companyTags: ['tcs', 'wipro']
  },
  {
    category: 'Logical Reasoning',
    subCategory: 'Coding-Decoding',
    difficulty: 'hard',
    questionText: 'If "ALGORITHM" is coded as "BMHPSJUIN", how is "DATABASE" coded under the same rule?',
    options: ['EBUBCBTF', 'EBUABBTF', 'EBUBCCTF', 'EBVBABTF'],
    correctAnswer: 'EBUBCBTF',
    explanation: 'Each character is shifted forward by +1 in the alphabet (A->B, L->M, G->H...). Therefore: D->E, A->B, T->U, A->B, B->C, A->B, S->T, E->F => EBUBCBTF.',
    companyTags: ['zoho', 'amazon', 'accenture']
  },

  // Verbal Ability
  {
    category: 'Verbal Ability',
    subCategory: 'Sentence Correction',
    difficulty: 'easy',
    questionText: 'Select the grammatically correct sentence:',
    options: [
      'Neither the team lead nor the developers was aware of the bug.',
      'Neither the team lead nor the developers were aware of the bug.',
      'Neither the team lead or the developers was aware of the bug.',
      'Neither the team lead nor the developers are been aware of the bug.'
    ],
    correctAnswer: 'Neither the team lead nor the developers were aware of the bug.',
    explanation: 'In "neither... nor" structures, the verb agrees in number with the closer subject ("developers", which is plural, so "were").',
    companyTags: ['tcs', 'infosys', 'accenture']
  },
  {
    category: 'Verbal Ability',
    subCategory: 'Vocabulary & Idioms',
    difficulty: 'medium',
    questionText: 'What is the most accurate synonym for the word "EPHEMERAL"?',
    options: ['Permanent', 'Transient', 'Profound', 'Spurious'],
    correctAnswer: 'Transient',
    explanation: '"Ephemeral" means lasting for a very short time; fleeting or transient.',
    companyTags: ['cognizant', 'capgemini', 'wipro']
  },
  {
    category: 'Verbal Ability',
    subCategory: 'Reading Comprehension',
    difficulty: 'hard',
    questionText: 'Identify the flaw in the argument: "Every software engineer at Company X uses MacBooks. Rahul uses a MacBook. Therefore, Rahul must be an engineer at Company X."',
    options: [
      'Affirming the consequent',
      'Denying the antecedent',
      'Ad Hominem',
      'Circular Reasoning'
    ],
    correctAnswer: 'Affirming the consequent',
    explanation: 'Just because all Company X engineers use MacBooks does not imply that anyone using a MacBook is an engineer at Company X.',
    companyTags: ['amazon', 'google', 'oracle']
  },

  // Technical & DSA
  {
    category: 'Technical',
    subCategory: 'Data Structures',
    difficulty: 'easy',
    questionText: 'What is the average time complexity of searching for an element in a balanced Hash Table?',
    options: ['O(1)', 'O(log N)', 'O(N)', 'O(N log N)'],
    correctAnswer: 'O(1)',
    explanation: 'A balanced hash table with a good hash function computes the bucket index in constant time O(1) on average.',
    companyTags: ['amazon', 'microsoft', 'google', 'zoho']
  },
  {
    category: 'Technical',
    subCategory: 'Algorithms',
    difficulty: 'medium',
    questionText: 'Which sorting algorithm guarantees O(N log N) time complexity even in the worst-case scenario?',
    options: ['Quick Sort', 'Merge Sort', 'Bubble Sort', 'Insertion Sort'],
    correctAnswer: 'Merge Sort',
    explanation: 'Merge Sort divides the array into halves recursively and merges them in linear time, guaranteeing O(N log N) in all cases (Best, Average, Worst). Quick Sort degrades to O(N^2) worst-case.',
    companyTags: ['amazon', 'tcs', 'microsoft', 'zoho']
  },
  {
    category: 'Technical',
    subCategory: 'Databases & System Design',
    difficulty: 'medium',
    questionText: 'In relational database theory, what does ACID stand for?',
    options: [
      'Atomicity, Consistency, Isolation, Durability',
      'Accuracy, Consistency, Integrity, Durability',
      'Atomicity, Concurrency, Isolation, Determinism',
      'Asynchronous, Cached, Indexed, Distributed'
    ],
    correctAnswer: 'Atomicity, Consistency, Isolation, Durability',
    explanation: 'ACID guarantees that database transactions are processed reliably.',
    companyTags: ['oracle', 'amazon', 'zoho', 'infosys']
  },
  {
    category: 'Technical',
    subCategory: 'Dynamic Programming',
    difficulty: 'hard',
    questionText: 'What is the optimal time and space complexity to find the Longest Increasing Subsequence (LIS) of an array of length N?',
    options: ['O(N^2) time, O(N) space', 'O(N log N) time, O(N) space', 'O(N) time, O(1) space', 'O(2^N) time, O(N) space'],
    correctAnswer: 'O(N log N) time, O(N) space',
    explanation: 'Using patience sorting with binary search (bisect), the LIS can be computed in O(N log N) time and O(N) auxiliary space.',
    companyTags: ['google', 'amazon', 'flipkart', 'microsoft']
  },

  // Data Interpretation
  {
    category: 'Data Interpretation',
    subCategory: 'Bar & Table Charts',
    difficulty: 'medium',
    questionText: 'Company sales grew from $2.4M in Q1 to $3.6M in Q2. What was the percentage increase in revenue?',
    options: ['33.3%', '50.0%', '66.7%', '45.0%'],
    correctAnswer: '50.0%',
    explanation: 'Growth = (3.6 - 2.4) / 2.4 = 1.2 / 2.4 = 0.50 -> 50.0% increase.',
    companyTags: ['tcs', 'infosys', 'accenture', 'cognizant']
  },
  {
    category: 'Data Interpretation',
    subCategory: 'Pie Charts & Ratios',
    difficulty: 'easy',
    questionText: 'A project budget pie chart allocates 40% to Engineering, 25% to Infrastructure, 20% to Marketing, and the rest to QA. If the total budget is $500,000, what is the QA allocation?',
    options: ['$50,000', '$75,000', '$100,000', '$60,000'],
    correctAnswer: '$75,000',
    explanation: 'QA percentage = 100% - (40% + 25% + 20%) = 15%. QA budget = 0.15 * $500,000 = $75,000.',
    companyTags: ['tcs', 'wipro', 'capgemini']
  },

  // Pseudo-Code Analysis
  {
    category: 'Pseudo-Code',
    subCategory: 'Loop & Flow Control',
    difficulty: 'medium',
    questionText: 'Trace the output:\nint a = 2, b = 5;\nwhile(b > 0) {\n  a = a * 2;\n  b = b - 2;\n}\nprint(a);',
    options: ['8', '16', '32', '64'],
    correctAnswer: '16',
    explanation: 'Iteration 1: b=5 > 0 -> a = 2*2=4, b=5-2=3. Iteration 2: b=3 > 0 -> a = 4*2=8, b=3-2=1. Iteration 3: b=1 > 0 -> a = 8*2=16, b=1-2=-1. Loop ends. Output = 16.',
    companyTags: ['infosys', 'capgemini', 'accenture']
  },
  {
    category: 'Pseudo-Code',
    subCategory: 'Recursion Trace',
    difficulty: 'hard',
    questionText: 'What does func(4) return?\nint func(int n) {\n  if(n <= 1) return 1;\n  return n + func(n - 2);\n}',
    options: ['7', '6', '10', '5'],
    correctAnswer: '7',
    explanation: 'func(4) = 4 + func(2). func(2) = 2 + func(0). Since 0 <= 1, func(0) = 1. Therefore func(2) = 2 + 1 = 3. func(4) = 4 + 3 = 7.',
    companyTags: ['zoho', 'infosys', 'capgemini', 'ltimindtree']
  },

  // Coding Section
  {
    category: 'Coding',
    subCategory: 'Algorithmic Problem Solving',
    difficulty: 'medium',
    questionText: 'Given an array of integers nums and an integer target, which approach finds two numbers such that they add up to target in O(N) time?',
    options: [
      'Two nested loops checking all pairs',
      'One pass using a Hash Map storing value-to-index mapping',
      'Binary Search on an unsorted array',
      'Recursive backtracking with memoization'
    ],
    correctAnswer: 'One pass using a Hash Map storing value-to-index mapping',
    explanation: 'By checking whether (target - nums[i]) exists in the Hash Map in O(1) average time during a single traversal, Two Sum is solved in O(N) linear time.',
    companyTags: ['amazon', 'google', 'microsoft', 'zoho']
  }
];

const seedDatabase = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prepai';
    if (mongoose.connection.readyState !== 1) await mongoose.connect(mongoUri);
    console.log('[Seed] Connected to MongoDB.');

    // Non-destructive: existing users, sessions and questions are never deleted.
    // Only the placement-officer account is created, with no invented activity.
    if (!(await User.findOne({ email: 'admin@prep.ai' }))) {
      const salt = await bcrypt.genSalt(10);
      const initialPassword = process.env.ADMIN_PASSWORD || '20062006';
      await User.create({
        email: 'admin@prep.ai',
        passwordHash: await bcrypt.hash(initialPassword, salt),
        fullName: 'Placement Officer',
        role: 'admin'
      });
      console.log(`[Seed] Admin account created (admin@prep.ai).`);
    }

    // Question bank: add any seed question that is missing, keep everything already there
    const questions = balanceOptionPositions(QUESTIONS);
    const res = await QuestionBank.bulkWrite(questions.map(q => ({
      updateOne: { filter: { questionText: q.questionText }, update: { $setOnInsert: q }, upsert: true }
    })));
    console.log(`[Seed] Question bank ready (${res.upsertedCount || 0} added).`);
  } catch (err) {
    console.error('[Seed Error]:', err);
  }
};

module.exports = { seedDatabase, ROLES, COMPANIES, QUESTIONS };

if (require.main === module) {
  seedDatabase().then(() => mongoose.disconnect());
}
