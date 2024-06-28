import { useQuery } from "@tanstack/react-query";
import useAxiosSecure from "./useAxiosSecure";

const useSeeAllCategory = () => {
  const axiosSecure = useAxiosSecure();
  const {
    refetch,
    data: categories = [],
    isLoading,
  } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await axiosSecure.get(`/category`);
      return res.data;
    },
  });
  return { categories, refetch, isLoading };
};

export default useSeeAllCategory;
