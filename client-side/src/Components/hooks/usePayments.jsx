import { useQuery } from "@tanstack/react-query";
// import useAxiosPublic from "./useAxiosPublic";
import useAxiosSecure from "./useAxiosSecure";

const usePayments = () => {
  // const axiosPublic = useAxiosPublic();
  const axiosSecure = useAxiosSecure();

  const {
    data: payments = [],
    isLoading: loading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      let url = "https://hossain-farma-server.vercel.app/payments";
      const res = await axiosSecure.get(url);
      return res.data;
    },
  });

  return [payments, refetch, loading, error];
};

export default usePayments;
