'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { businessLabel, type BusinessProfile } from '@/lib/domain/tenancy/business-profile';
const Context = createContext<BusinessProfile | null>(null);
export function BusinessVocabulary({profile,children}:{profile:BusinessProfile|null;children:ReactNode}) { return <Context.Provider value={profile}>{children}</Context.Provider>; }
export function useBusinessLabel() { const profile=useContext(Context); return (label:string)=>businessLabel(profile,label); }
export function BusinessLabel({children}:{children:ReactNode}) { const label=useBusinessLabel();return <>{typeof children==='string'?label(children):children}</>; }
