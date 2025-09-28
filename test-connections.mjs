#!/usr/bin/env node

// Test script to check connections endpoint
import fetch from 'node-fetch';

const BASE_URL = 'https://agent.firstprinciple.co';

async function testConnections() {
  console.log('🔍 Testing connections endpoint...\n');
  
  try {
    // Test 1: Check if endpoint exists
    console.log('1. Testing /api/connections endpoint...');
    const response = await fetch(`${BASE_URL}/api/connections`, {
      method: 'GET',
      headers: {
        'x-user-id': 'thomas@firstprinciple.co',
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Headers:`, Object.fromEntries(response.headers.entries()));
    
    if (response.ok) {
      const data = await response.json();
      console.log('   ✅ Success! Response data:');
      console.log(JSON.stringify(data, null, 2));
    } else {
      const errorText = await response.text();
      console.log('   ❌ Error response:');
      console.log(errorText);
    }
    
  } catch (error) {
    console.log('   ❌ Network error:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  try {
    // Test 2: Check other endpoints for comparison
    console.log('2. Testing other endpoints for comparison...');
    
    const endpoints = [
      '/api/profile',
      '/api/agents/accessible', 
      '/api/conversations',
      '/api/relationships'
    ];
    
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${BASE_URL}${endpoint}`, {
          headers: {
            'x-user-id': 'thomas@firstprinciple.co',
            'Content-Type': 'application/json'
          }
        });
        console.log(`   ${endpoint}: ${res.status} ${res.statusText}`);
        
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            console.log(`     → Array with ${data.length} items`);
          } else if (data && typeof data === 'object') {
            console.log(`     → Object with keys: ${Object.keys(data).join(', ')}`);
          }
        }
      } catch (e) {
        console.log(`   ${endpoint}: Error - ${e.message}`);
      }
    }
    
  } catch (error) {
    console.log('   ❌ Comparison test error:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  try {
    // Test 3: Check if we can create a relationship
    console.log('3. Testing relationship creation...');
    
    const relationshipData = {
      toActorId: 'test-actor-id',
      kind: 'follow'
    };
    
    const res = await fetch(`${BASE_URL}/api/relationships`, {
      method: 'POST',
      headers: {
        'x-user-id': 'thomas@firstprinciple.co',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(relationshipData)
    });
    
    console.log(`   POST /api/relationships: ${res.status} ${res.statusText}`);
    
    if (res.ok) {
      const data = await res.json();
      console.log('   ✅ Relationship creation response:');
      console.log(JSON.stringify(data, null, 2));
    } else {
      const errorText = await res.text();
      console.log('   ❌ Relationship creation error:');
      console.log(errorText);
    }
    
  } catch (error) {
    console.log('   ❌ Relationship test error:', error.message);
  }
}

// Run the test
testConnections().catch(console.error);
