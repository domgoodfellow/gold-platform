'use client';
import { createContext } from 'react';
/** Supplied by the persistent activity owner; navigation consumes only a retention hint. */
export const NavigationActivityContext = createContext(false);
