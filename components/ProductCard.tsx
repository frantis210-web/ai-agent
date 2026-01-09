import React from 'react';
import { Product } from '../types';

interface ProductCardProps {
  product: Product;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  return (
    <div className="bg-wick-dark border border-gray-800 rounded-xl p-6 relative hover:border-wick-purple transition-all duration-300 hover:shadow-[0_0_15px_rgba(124,58,237,0.2)] group">
      {product.tag && (
        <span className="absolute -top-3 right-4 bg-gradient-to-r from-wick-purple to-pink-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
          {product.tag}
        </span>
      )}
      <h3 className="font-display font-bold text-xl text-white mb-2 group-hover:text-wick-cyan transition-colors">{product.name}</h3>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold text-wick-cyan">{product.price}</span>
        {product.originalPrice && (
          <span className="text-sm text-gray-500 line-through decoration-red-500">{product.originalPrice}</span>
        )}
      </div>
      <p className="text-gray-400 text-sm leading-relaxed">
        {product.description}
      </p>
      <button className="mt-4 w-full py-2 rounded-lg bg-gray-800 hover:bg-wick-purple text-white font-semibold text-sm transition-all duration-300 border border-gray-700 hover:border-transparent">
        View Details
      </button>
    </div>
  );
};
